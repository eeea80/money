/**
 * Scavenge tool calls that the model emitted as text instead of via the
 * structured tool_use channel. Ported from reasonix (MIT) and adapted to
 * Franklin's Anthropic-shape `CapabilityInvocation` (parsed `input` object
 * + synthetic id).
 *
 * Triggers we've actually seen:
 *  - DeepSeek R1 leaks tool-call JSON into `reasoning_content` and forgets
 *    to populate `tool_calls`. The text channel ends up with raw JSON like
 *    `{"name":"Read","arguments":{...}}`.
 *  - DeepSeek V3.1 sometimes emits its chat-template DSML markup
 *    (`<｜DSML｜invoke …>`) in the content channel.
 *  - Smaller OpenAI-compatible models (some Qwen / Llama variants behind
 *    the BlockRun gateway) leak the OpenAI tool-call shape inline.
 *
 * All three are recoverable. This module turns the leaked text back into
 * a `CapabilityInvocation` so the agent loop doesn't waste a turn telling
 * the model "you forgot to call a tool".
 */
import { randomBytes } from 'node:crypto';
import type { CapabilityInvocation } from '../types.js';

export interface ScavengeOptions {
  /** Allowlist of tool names the model is permitted to call. */
  allowedNames: ReadonlySet<string>;
  /** Cap on scavenged calls per pass — defence against runaway. */
  maxCalls?: number;
}

export interface ScavengeResult {
  calls: CapabilityInvocation[];
  notes: string[];
}

/** Bounds regex input — DSML matchers are O(n²) on adversarial input. */
const MAX_SCAVENGE_INPUT = 100 * 1024;

export function scavengeToolCalls(
  text: string | null | undefined,
  opts: ScavengeOptions,
): ScavengeResult {
  if (!text) return { calls: [], notes: [] };
  if (text.length > MAX_SCAVENGE_INPUT) {
    return {
      calls: [],
      notes: [`scavenge skipped: input too large (${text.length} chars)`],
    };
  }
  const max = opts.maxCalls ?? 4;
  const notes: string[] = [];
  const out: CapabilityInvocation[] = [];

  // Pattern A — DSML invoke blocks (DeepSeek chat-template markup leaked
  // into the content channel).
  for (const invoke of iterateDsmlInvokes(text)) {
    if (out.length >= max) break;
    const resolved = resolveAllowedName(invoke.name, opts.allowedNames);
    if (!resolved) continue;
    out.push(makeInvocation(resolved, invoke.args));
    notes.push(`scavenged DSML call: ${resolved}`);
  }

  // Pattern B — raw JSON objects in the three canonical shapes. Strip
  // DSML blocks first so their parameter payloads don't get re-scavenged
  // as standalone JSON calls.
  const nonDsml = stripDsmlBlocks(text);
  for (const candidate of iterateJsonObjects(nonDsml)) {
    if (out.length >= max) break;
    for (const call of coerceToInvocations(candidate, opts.allowedNames)) {
      if (out.length >= max) break;
      out.push(call);
      notes.push(`scavenged call: ${call.name}`);
    }
  }
  return { calls: out, notes };
}

interface DsmlInvoke {
  name: string;
  args: Record<string, unknown>;
}

function stripDsmlBlocks(text: string): string {
  let out = text;
  out = out.replace(/<[｜|]DSML[｜|]function_calls>[\s\S]*?<\/?[｜|]DSML[｜|]function_calls>/g, '');
  out = out.replace(/<[｜|]DSML[｜|]invoke\s+[^>]*>[\s\S]*?<\/[｜|]DSML[｜|]invoke>/g, '');
  return out;
}

function* iterateDsmlInvokes(text: string): Generator<DsmlInvoke> {
  // `｜` (U+FF5C) in practice; `|` (ASCII) as a fallback variant.
  const INVOKE_RE = /<[｜|]DSML[｜|]invoke\s+name="([^"]+)">([\s\S]*?)<\/[｜|]DSML[｜|]invoke>/g;
  for (const match of text.matchAll(INVOKE_RE)) {
    const name = match[1];
    const body = match[2];
    if (!name || body === undefined) continue;
    yield { name, args: parseDsmlParameters(body) };
  }
}

function parseDsmlParameters(body: string): Record<string, unknown> {
  const PARAM_RE =
    /<[｜|]DSML[｜|]parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?\s*>([\s\S]*?)<\/[｜|]DSML[｜|]parameter>/g;
  const args: Record<string, unknown> = {};
  for (const m of body.matchAll(PARAM_RE)) {
    const key = m[1];
    const stringFlag = m[2];
    const raw = (m[3] ?? '').trim();
    if (!key) continue;
    if (stringFlag === 'false') {
      try {
        args[key] = JSON.parse(raw);
        continue;
      } catch {
        // Fall through — preserve literal so info isn't lost.
      }
    }
    args[key] = raw;
  }
  return args;
}

function* iterateJsonObjects(text: string): Generator<string> {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (inString) {
        if (c === '\\') {
          escaped = true;
          continue;
        }
        if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          yield text.slice(i, j + 1);
          i = j;
          break;
        }
      }
    }
  }
}

function coerceToInvocations(
  candidateJson: string,
  allowedNames: ReadonlySet<string>,
): CapabilityInvocation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidateJson);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const obj = parsed as Record<string, unknown>;

  // Envelope A — OpenAI assistant message { tool_calls: [ {...}, ... ] }.
  // Gateway models that lack native tool-calling sometimes dump the whole
  // assistant-message JSON into the text channel.
  if (Array.isArray(obj.tool_calls)) {
    const calls: CapabilityInvocation[] = [];
    for (const tc of obj.tool_calls) {
      const c = coerceObj(tc, allowedNames);
      if (c) calls.push(c);
    }
    return calls;
  }

  // Envelope B — legacy single { function_call: { name, arguments } }.
  if (obj.function_call && typeof obj.function_call === 'object') {
    const c = coerceObj({ type: 'function', function: obj.function_call }, allowedNames);
    return c ? [c] : [];
  }

  const c = coerceObj(obj, allowedNames);
  return c ? [c] : [];
}

function coerceObj(
  value: unknown,
  allowedNames: ReadonlySet<string>,
): CapabilityInvocation | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;

  // Pattern 1 — { name, arguments } (Anthropic-ish flat form) AND the flat
  // OpenAI leak { type: "function", name, parameters } emitted by the free
  // DeepSeek model — both carry the name at the top level. Args land under
  // `arguments` or `parameters` depending on the model's chat template.
  if (typeof obj.name === 'string') {
    const resolved = resolveAllowedName(obj.name, allowedNames);
    if (resolved) {
      return makeInvocation(resolved, normalizeArgs(obj.arguments ?? obj.parameters));
    }
  }

  // Pattern 2 — OpenAI-style { type: "function", function: { name, arguments } }.
  if (
    obj.type === 'function' &&
    obj.function &&
    typeof obj.function === 'object'
  ) {
    const fn = obj.function as Record<string, unknown>;
    const resolved = typeof fn.name === 'string' ? resolveAllowedName(fn.name, allowedNames) : null;
    if (resolved) {
      return makeInvocation(resolved, normalizeArgs(fn.arguments ?? fn.parameters));
    }
  }

  // Pattern 3 — { tool_name, tool_args } (R1 free-form variant).
  if (typeof obj.tool_name === 'string') {
    const resolved = resolveAllowedName(obj.tool_name, allowedNames);
    if (resolved) {
      return makeInvocation(resolved, normalizeArgs(obj.tool_args ?? obj.tool_parameters));
    }
  }

  return null;
}

/** Collapse a tool name to a comparison key: lowercase, drop separators.
 *  `activate_tool` / `web_search` → `activatetool` / `websearch`. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_\-\s]/g, '');
}

/** Resolve a leaked tool name to its canonical registry spelling. Exact
 *  match wins; otherwise a separator/case-insensitive match lets models
 *  that rewrite names to OpenAI snake_case (`web_search` → `WebSearch`)
 *  still be recovered. Returns null if no allowed tool matches. */
function resolveAllowedName(
  name: string | null | undefined,
  allowedNames: ReadonlySet<string>,
): string | null {
  if (!name || typeof name !== 'string') return null;
  if (allowedNames.has(name)) return name;
  // Try the name as-is, then with any provider namespace stripped
  // (`functions.web_search` / `tools.web_search` → `web_search`), which
  // Gemini- and OpenAI-style function declarations sometimes prepend.
  const candidates = [name];
  if (name.includes('.')) candidates.push(name.slice(name.lastIndexOf('.') + 1));
  for (const candidate of candidates) {
    const target = normalizeName(candidate);
    for (const allowed of allowedNames) {
      if (normalizeName(allowed) === target) return allowed;
    }
  }
  return null;
}

function normalizeArgs(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function makeInvocation(name: string, input: Record<string, unknown>): CapabilityInvocation {
  return {
    type: 'tool_use',
    id: `toolu_repair_${randomBytes(6).toString('hex')}`,
    name,
    input,
  };
}
