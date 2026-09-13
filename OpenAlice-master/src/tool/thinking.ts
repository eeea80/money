import { tool } from 'ai';
import { z } from 'zod';
import { calculate } from '@/domain/thinking/tools/calculate.tool';

/**
 * Create thinking AI tools (cognition + utility, no data dependency)
 *
 * Active tools:
 * - calculate: Safe mathematical expression evaluation
 *
 * Disabled (low usage, overlaps with current architecture):
 * - think, plan, reportWarning, getConfirm
 */
export function createThinkingTools() {
  return {
    calculate: tool({
      description:
        'Perform mathematical calculations with precision. Use this for any arithmetic operations instead of calculating yourself. Supports basic operators: +, -, *, /, (), decimals.',
      inputSchema: z.object({
        expression: z
          .string()
          .describe(
            'Mathematical expression to evaluate, e.g. "100 / 50000", "(1000 * 0.1) / 2"',
          ),
      }).meta({ examples: [{ expression: '(1000 * 0.1) / 2' }] }),
      execute: ({ expression }) => {
        return calculate(expression);
      },
    }),
  };
}
