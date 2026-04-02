// src/modules/wg-pos/services/receipts-csv.service.ts
import { Injectable } from '@nestjs/common';
import { parseString } from '@fast-csv/parse';
import stores from '../../../../config/stores.json';


type Row = Record<string, any>;



type Store = {
    id: string;
    name: string;
    location: string;
    is_active: boolean;
    dutchie_store_id?: string;
};

function buildStoreLocationMap(): Map<string, number> {
    const map = new Map<string, number>();

    for (const s of stores as Store[]) {
        if (!s?.is_active) continue;
        const key = String(s.name ?? '').trim().toLowerCase();
        const id = Number(s.id);
        if (!key || !Number.isFinite(id)) continue;
        map.set(key, id);
    }

    return map;
}




const STORE_LOCATION_MAP = buildStoreLocationMap();

const storeAliases: Record<string, string> = {
    'Wellgreens - Balboa': 'Wellgreens - Kearny Mesa',
    'Wellgreens - Home': 'Wellgreens - City Heights',
};

function aliasStoreName(name: string): string {
    const trimmed = (name ?? '').trim();
    return storeAliases[trimmed] ?? trimmed;
}

function normalizeStoreName(name: string): string {
    return (name ?? '').trim().toLowerCase();
}


function resolveStoreIdFromLocation(locationValue: any): number {

    const storeNameAliased = aliasStoreName(locationValue);
    const normalized = normalizeStoreName(storeNameAliased);
    const id = STORE_LOCATION_MAP.get(normalized);
    if (!id) {
        throw new Error(`store_id no encontrado para Location="${locationValue}" (normalized="${normalized}")`);
    }
    return id;
}


@Injectable()
export class ReceiptsCsvService {
    async inspectCsv(
        buffer: Buffer,
        opts: { headerRow: number },
    ): Promise<{
        header_row: number;
        delimiter: string;
        columns: string[];
        total_rows: number;
        sample_rows: Row[];
    }> {
        const text = buffer.toString('utf8');
        const delimiter = this.detectDelimiter(text);
        const skip = Math.max(0, (opts.headerRow ?? 4) - 1);

        // Parseo base
        const rawRows = await this.parseCsv(text, {
            delimiter,
            skipRows: skip,
            headers: true,
            trim: true,
            ignoreEmpty: true,
        });

        // Normalización de encabezados a “canónico”
        const rows = rawRows.map((r) => this.normalizeHeaders(r));

        const columns = rows.length ? Object.keys(rows[0]) : [];
        const sample_rows = rows.slice(0, 10);
        const total_rows = rows.length;

        return { header_row: opts.headerRow ?? 4, delimiter, columns, total_rows, sample_rows };
    }

    // === NUEVO: dry-run con normalización de valores (sin DB) ===
    async inspectCsvNormalized(
        buffer: Buffer,
        opts: { headerRow: number; tz?: string },
    ): Promise<{
        header_row: number;
        delimiter: string;
        columns: string[];
        total_rows: number;
        normalized_sample: Row[];
        errors_sample: Array<{ line: number; error: string }>;
    }> {
        const text = buffer.toString('utf8');
        const delimiter = this.detectDelimiter(text);
        const skip = Math.max(0, (opts.headerRow ?? 4) - 1);

        const rawRows = await this.parseCsv(text, {
            delimiter,
            skipRows: skip,
            headers: true,
            trim: true,
            ignoreEmpty: true,
        });

        const canonRows = rawRows.map((r) => this.normalizeHeaders(r));

        const errors: Array<{ line: number; error: string }> = [];
        const out: Row[] = [];

        // Reglas confirmadas contigo
        const NUMERIC_FIELDS = [
            'Products',
            'Total Cost'
        ];
        // const BOOL_FIELD = 'Paid';
        const DATE_FIELDS = ['Received On', 'Due Date'];

        for (let i = 0; i < canonRows.length; i++) {
            const src = canonRows[i];
            const dst: Row = { ...src };

            // Title vacío/mal formado → Title = NULL y no intentaremos resolver received_inventory_id aquí
            const titleOk = this.isTitleWellFormedOrValid(dst['Title']);
            if (!titleOk) {
                if (this.isEmptyLike(dst['Title'])) {
                    dst['Title'] = null;
                }
            }

            // Limpieza numérica para montos/cantidades (vacío/-/N/A → 0.0; paréntesis = negativo)
            for (const f of NUMERIC_FIELDS) {
                try {
                    dst[f] = this.toFloatStrictOrZero(dst[f]);
                } catch (e: any) {
                    errors.push({ line: skip + i + 1, error: `Campo numérico inválido "${f}": ${e.message}` });
                    // no abortamos: dejamos 0.0 para seguir viendo el resto
                    dst[f] = 0.0;
                }
            }

            // Booleano
            // try {
            //     dst[BOOL_FIELD] = this.toBooleanOrNull(dst[BOOL_FIELD]);
            // } catch (e: any) {
            //     errors.push({ line: skip + i + 1, error: `Campo booleano inválido "Paid": ${e.message}` });
            //     dst[BOOL_FIELD] = null;
            // }

            // Fecha → ISO (asumiendo sólo fecha MM/DD/YYYY; se interpreta a 00:00:00 en tz)

            for (const f of DATE_FIELDS) {
                try { dst[f] = this.toUtcMidnightOrNull(dst[f]); }
                catch { dst[f] = null; }
            }

            out.push(dst);
        }

        return {
            header_row: opts.headerRow ?? 4,
            delimiter,
            columns: out.length ? Object.keys(out[0]) : [],
            total_rows: out.length,
            normalized_sample: out.slice(0, 10),
            errors_sample: errors.slice(0, 20),
        };
    }

    // --- Helpers ---

    private normalizeHeaders(row: Record<string, any>) {
        const headerAliases: Record<string, string> = {
            VendorLicense: 'Vendor License',
            status: 'Status',
            DeliveredBy: 'Delivered By',
            ReceivedBy: 'Received By',
            'Received On': 'Received On',
            'Invoice #': 'Transaction ID',
            'Due Date (notes)': 'Due Date'
        };
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(row)) {
            out[headerAliases[k] ?? k] = v;
        }
        return out;
    }

    private detectDelimiter(text: string): string {
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 30);
        const candidates = [',', ';', '\t'];
        let best = ',';
        let bestScore = -1;
        for (const cand of candidates) {
            const counts = lines.map((l) => (l.match(new RegExp(`\\${cand}`, 'g')) || []).length);
            const avg = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
            if (avg > bestScore) {
                bestScore = avg;
                best = cand;
            }
        }
        return best;
    }

    private async parseCsv(
        text: string,
        opts: { delimiter: string; skipRows: number; headers: boolean; trim: boolean; ignoreEmpty: boolean },
    ): Promise<Row[]> {
        return new Promise((resolve, reject) => {
            const out: Row[] = [];
            const lines = text.split(/\r?\n/);
            const sliced = lines.slice(opts.skipRows).join('\n');

            parseString(sliced, {
                delimiter: opts.delimiter,
                headers: opts.headers,
                ignoreEmpty: opts.ignoreEmpty,
                trim: opts.trim,
            })
                .on('error', reject)
                .on('data', (row: Row) => out.push(row))
                .on('end', () => resolve(out));
        });
    }

    private isEmptyLike(val: any) {
        if (val === null || val === undefined) return true;
        const s = String(val).trim().toLowerCase();
        return s === '' || s === '-' || s === 'n/a' || s === 'na' || s === 'null' || s === 'none';
    }

    private toFloatStrictOrZero(val: any): number {
        if (this.isEmptyLike(val)) return 0.0;

        let s = String(val).trim();

        // Paréntesis = negativo
        let negative = false;
        if (/^\(.*\)$/.test(s)) {
            negative = true;
            s = s.slice(1, -1);
        }

        // quita símbolos y espacios
        s = s.replace(/[\$\+\s\u00A0]/g, '');

        // normalización decimal: si no hay punto y sí hay coma → coma es decimal
        if (s.includes(',') && !s.includes('.')) {
            s = s.replace(',', '.');
        } else {
            // si hay punto y coma → coma como miles
            s = s.replace(/,/g, '');
        }

        const num = Number(s);
        if (!Number.isFinite(num)) throw new Error(`no numérico: "${val}"`);
        return negative ? -Math.abs(num) : num;
    }

    private toBooleanOrNull(val: any): boolean | null {
        if (this.isEmptyLike(val)) return null;
        const s = String(val).trim().toLowerCase();
        if (['true', 't', '1', 'yes', 'y'].includes(s)) return true;
        if (['false', 'f', '0', 'no', 'n'].includes(s)) return false;
        throw new Error(`valor no reconocido: "${val}"`);
    }

    private toUtcMidnightOrNull(val: unknown): string | null {
        if (this.isEmptyLike(val)) return null;

        const s = String(val).trim();
        // acepta 1 o 2 dígitos para día/mes y 2 o 4 para año, separador / o -, ignora hora posterior
        const m = s.match(/^\s*(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})\b/i);
        if (!m) {
            const msg = `formato esperado MM/DD/YYYY o DD/MM/YYYY (año 2 o 4 dígitos; opcionalmente seguido de hora), recibido "${s}"`;
            console.log(msg);
            throw new Error(msg);
        }

        let [, aStr, bStr, yStr] = m;
        const a = Number(aStr);
        const b = Number(bStr);

        // normaliza año (00–69 -> 2000–2069; 70–99 -> 1970–1999)
        let yyyy: number;
        if (yStr.length === 2) {
            const yy = Number(yStr);
            if (!Number.isFinite(yy)) {
                throw new Error(`año inválido: "${yStr}"`);
            }
            yyyy = yy <= 69 ? 2000 + yy : 1900 + yy;
        } else {
            yyyy = Number(yStr);
        }

        // decide formato
        let mm: number, dd: number;
        if (a > 12 && b <= 12) {
            // DD/MM
            dd = a; mm = b;
        } else if (b > 12 && a <= 12) {
            // MM/DD
            mm = a; dd = b;
        } else if (a > 12 && b > 12) {
            const msg = `fecha inválida: mes y día no pueden ser > 12 a la vez ("${s}")`;
            console.log(msg);
            throw new Error(msg);
        } else {
            // ambos <= 12 → ambiguo: por defecto asumimos DD/MM (México)
            dd = a; mm = b; // <-- si prefieres MM/DD como default, invierte estas dos líneas
        }

        if (mm < 1 || mm > 12) {
            const msg = `mes inválido: "${mm}"`;
            console.log(msg);
            throw new Error(msg);
        }
        const maxDay = this.daysInMonth(yyyy, mm);
        if (dd < 1 || dd > maxDay) {
            const msg = `día inválido para ${yyyy}-${String(mm).padStart(2, '0')}: "${dd}"`;
            console.log(msg);
            throw new Error(msg);
        }

        const mm2 = String(mm).padStart(2, '0');
        const dd2 = String(dd).padStart(2, '0');
        return `${yyyy}-${mm2}-${dd2} 00:00:00.000+00`;
    }


    // helpers (puedes moverlos a utilidades)
    private isLeapYear(y: number): boolean {
        return (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0));
    }

    private daysInMonth(y: number, m: number): number {
        return [0, 31, (this.isLeapYear(y) ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m];
    }



    private isTitleWellFormedOrValid(val: any): boolean {
        if (this.isEmptyLike(val)) return false;
        const s = String(val);
        const parts = s.split('-');
        return parts.length >= 3 || !this.isEmptyLike(val); // fecha - vendor - folio
    }

    private isTitleWellFormed(val: any): boolean {
        if (this.isEmptyLike(val)) return false;
        const s = String(val);
        const parts = s.split('-');
        return parts.length >= 3; // fecha - vendor - folio
    }

    private getTitleID(val: any): String {
        if (this.isEmptyLike(val)) return "";
        const s = String(val);
        const parts = s.split('-');
        return parts[2];
    }

    // src/modules/wg-pos/services/receipts-csv.service.ts
    // …deja lo que ya tienes… y agrega este método al final de la clase:

    /** Devuelve TODAS las filas normalizadas (no solo sample). */
    async parseAllNormalized(
        buffer: Buffer,
        opts: { headerRow: number; tz?: string } = { headerRow: 0, tz: 'America/Hermosillo' },
    ): Promise<Record<string, any>[]> {
        const text = buffer.toString('utf8');
        const delimiter = this.detectDelimiter(text);
        const skip = Math.max(0, (opts.headerRow ?? 4) - 1);

        const rawRows = await this.parseCsv(text, {
            delimiter,
            skipRows: skip,
            headers: true,
            trim: true,
            ignoreEmpty: true,
        });

        const canon = rawRows.map((r) => this.normalizeHeaders(r));

        const NUMERIC_FIELDS = ['Products', 'Total Cost'];
        // const BOOL_FIELD = 'Paid';
        const DATE_FIELDS = ['Received On', 'Due Date'];

        const out: Record<string, any>[] = [];
        for (const src of canon) {
            const dst: Record<string, any> = { ...src };

            // Title vacío/mal formado → NULL
            if (!this.isTitleWellFormedOrValid(dst['Title'])) {
                if (this.isEmptyLike(dst['Title'])) {
                    dst['Title'] = null;
                }
            }

            for (const f of NUMERIC_FIELDS) {
                try { dst[f] = this.toFloatStrictOrZero(dst[f]); }
                catch { dst[f] = 0.0; }
            }

            // try { dst[BOOL_FIELD] = this.toBooleanOrNull(dst[BOOL_FIELD]); }
            // catch { dst[BOOL_FIELD] = null; }

            for (const f of DATE_FIELDS) {
                try { dst[f] = this.toUtcMidnightOrNull(dst[f]); }
                catch { dst[f] = null; }
            }

            if (this.isTitleWellFormed(dst['Title'])) {
                dst['Metric ID'] = this.getTitleID(dst['Title']).trim();
            } else {
                dst['Metric ID'] = null;
            }

            try {
                dst['Store ID'] = resolveStoreIdFromLocation(dst['Location']);
            } catch {
                dst['Store ID'] = null; // no revienta normalización; se valida en importer si quieres
            }

            out.push(dst);
        }
        return out;
    }

}
