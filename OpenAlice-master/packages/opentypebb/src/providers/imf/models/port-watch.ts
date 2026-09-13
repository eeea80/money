/**
 * IMF PortWatch Fetchers — ports + maritime chokepoints.
 * Maps to: openbb_imf/models/{port_info,port_volume,maritime_chokepoint_*}.py
 *
 * Source: IMF PortWatch (portwatch.imf.org) — satellite AIS data for 1,802
 * ports and 24 chokepoints, hosted as public ArcGIS feature layers (keyless,
 * updated weekly on Tuesdays). The daily layers carry vessel counts
 * (n_total / n_cargo / n_tanker / …) and capacity estimates in metric tons.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { PortInfoQueryParamsSchema } from '../../../standard-models/port-info.js'
import { PortVolumeQueryParamsSchema } from '../../../standard-models/port-volume.js'
import { ChokepointInfoQueryParamsSchema } from '../../../standard-models/chokepoint-info.js'
import { ChokepointVolumeQueryParamsSchema } from '../../../standard-models/chokepoint-volume.js'

const ARCGIS_BASE = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services'
const PORTS_DB = `${ARCGIS_BASE}/PortWatch_ports_database/FeatureServer/0/query`
const CHOKEPOINTS_DB = `${ARCGIS_BASE}/PortWatch_chokepoints_database/FeatureServer/0/query`
const DAILY_PORTS = `${ARCGIS_BASE}/Daily_Ports_Data/FeatureServer/0/query`
const DAILY_CHOKEPOINTS = `${ARCGIS_BASE}/Daily_Chokepoints_Data/FeatureServer/0/query`

interface ArcGisResponse {
  features?: Array<{ attributes: Record<string, unknown> }>
  error?: { message?: string }
}

async function arcgisQuery(
  baseUrl: string,
  opts: { where?: string; outFields?: string; orderBy?: string; limit?: number },
): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams({
    where: opts.where ?? '1=1',
    outFields: opts.outFields ?? '*',
    returnGeometry: 'false',
    f: 'json',
  })
  if (opts.orderBy) qs.set('orderByFields', opts.orderBy)
  if (opts.limit) qs.set('resultRecordCount', String(opts.limit))
  const data = await amakeRequest<ArcGisResponse>(`${baseUrl}?${qs.toString()}`)
  if (data.error) throw new Error(`PortWatch ArcGIS error: ${data.error.message ?? 'unknown'}`)
  return (data.features ?? []).map((f) => f.attributes)
}

/** Escape a single-quoted ArcGIS SQL literal. */
function sq(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

/** Filter on name OR id — PortWatch ids look like 'port123' / 'chokepoint1'. */
function nameOrIdWhere(value: string): string {
  return `(portid = ${sq(value)} OR LOWER(portname) LIKE ${sq('%' + value.toLowerCase() + '%')})`
}

function dateRangeWhere(start?: string | null, end?: string | null): string[] {
  const parts: string[] = []
  if (start) parts.push(`date >= DATE ${sq(start)}`)
  if (end) parts.push(`date <= DATE ${sq(end)}`)
  return parts
}

// --- Port Info ---

export class ImfPortInfoFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>) {
    return PortInfoQueryParamsSchema.parse(params)
  }

  static override async extractData(query: z.infer<typeof PortInfoQueryParamsSchema>) {
    const where = query.port ? nameOrIdWhere(query.port) : '1=1'
    const rows = await arcgisQuery(PORTS_DB, {
      where,
      outFields: 'portid,portname,country,ISO3,continent,fullname,lat,lon,vessel_count_total',
      orderBy: 'vessel_count_total DESC',
      limit: query.port ? 50 : 2500,
    })
    if (rows.length === 0) throw new EmptyDataError(`No PortWatch port matches "${query.port}".`)
    return rows
  }

  static override transformData(_query: unknown, data: Record<string, unknown>[]) {
    return data.map((d) => ({
      port_code: d.portid ?? null,
      port_name: d.portname ?? null,
      country: d.country ?? null,
      latitude: typeof d.lat === 'number' ? d.lat : null,
      longitude: typeof d.lon === 'number' ? d.lon : null,
      continent: d.continent ?? null,
      vessel_count_total: d.vessel_count_total ?? null,
    }))
  }
}

// --- Port Volume (daily activity) ---

export class ImfPortVolumeFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>) {
    return PortVolumeQueryParamsSchema.parse(params)
  }

  static override async extractData(query: z.infer<typeof PortVolumeQueryParamsSchema>) {
    if (!query.port) {
      throw new EmptyDataError('A port id or name is required (use port_info to find it).')
    }
    const where = [nameOrIdWhere(query.port), ...dateRangeWhere(query.start_date, query.end_date)].join(' AND ')
    const rows = await arcgisQuery(DAILY_PORTS, { where, orderBy: 'date ASC', limit: 2000 })
    if (rows.length === 0) throw new EmptyDataError(`No PortWatch activity for "${query.port}" in range.`)
    return rows
  }

  static override transformData(_query: unknown, data: Record<string, unknown>[]) {
    // Daily_Ports uses portcalls_* / import / export (≠ the chokepoint
    // layer's n_* / capacity naming).
    return data.map((d) => ({
      date: String(d.date ?? ''),
      port_code: d.portid ?? null,
      port_name: d.portname ?? null,
      portcalls: d.portcalls ?? null,
      portcalls_container: d.portcalls_container ?? null,
      portcalls_tanker: d.portcalls_tanker ?? null,
      portcalls_dry_bulk: d.portcalls_dry_bulk ?? null,
      // volume = import + export trade estimate (metric tons).
      volume:
        typeof d.import === 'number' && typeof d.export === 'number'
          ? d.import + d.export
          : d.import ?? d.export ?? null,
      import_tons: d.import ?? null,
      export_tons: d.export ?? null,
      unit: 'metric tons',
    }))
  }
}

// --- Chokepoint Info ---

export class ImfChokepointInfoFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>) {
    return ChokepointInfoQueryParamsSchema.parse(params)
  }

  static override async extractData(query: z.infer<typeof ChokepointInfoQueryParamsSchema>) {
    const where = query.chokepoint ? nameOrIdWhere(query.chokepoint) : '1=1'
    const rows = await arcgisQuery(CHOKEPOINTS_DB, { where, limit: 50 })
    if (rows.length === 0) throw new EmptyDataError(`No PortWatch chokepoint matches "${query.chokepoint}".`)
    return rows
  }

  static override transformData(_query: unknown, data: Record<string, unknown>[]) {
    return data.map((d) => ({
      chokepoint_code: d.portid ?? null,
      name: d.portname ?? null,
      latitude: typeof d.lat === 'number' ? d.lat : null,
      longitude: typeof d.lon === 'number' ? d.lon : null,
      vessel_count_total: d.vessel_count_total ?? null,
    }))
  }
}

// --- Chokepoint Volume (daily transit) ---

export class ImfChokepointVolumeFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>) {
    return ChokepointVolumeQueryParamsSchema.parse(params)
  }

  static override async extractData(query: z.infer<typeof ChokepointVolumeQueryParamsSchema>) {
    const parts = [...dateRangeWhere(query.start_date, query.end_date)]
    if (query.chokepoint) parts.unshift(nameOrIdWhere(query.chokepoint))
    const rows = await arcgisQuery(DAILY_CHOKEPOINTS, {
      where: parts.length ? parts.join(' AND ') : '1=1',
      orderBy: 'date ASC',
      limit: 4000,
    })
    if (rows.length === 0) throw new EmptyDataError(`No PortWatch transit data for "${query.chokepoint}" in range.`)
    return rows
  }

  static override transformData(_query: unknown, data: Record<string, unknown>[]) {
    return data.map((d) => ({
      date: String(d.date ?? ''),
      chokepoint: d.portname ?? null,
      chokepoint_code: d.portid ?? null,
      vessels_total: d.n_total ?? null,
      vessels_cargo: d.n_cargo ?? null,
      vessels_tanker: d.n_tanker ?? null,
      vessels_container: d.n_container ?? null,
      vessels_dry_bulk: d.n_dry_bulk ?? null,
      // Total trade volume estimate of all transiting ships.
      volume: d.capacity ?? null,
      unit: 'metric tons',
    }))
  }
}
