/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Self-hosted LanguageTool instance; defaults to the public api.languagetool.org if unset */
  readonly VITE_LANGUAGETOOL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const url: string;
  export default url;
}

declare module '@citation-js/core' {
  export class Cite {
    constructor(data: unknown);
    format(type: string, options?: Record<string, unknown>): string;
  }
  export const plugins: unknown;
}

declare module '@citation-js/plugin-csl';

declare module 'mammoth' {
  export function extractRawText(
    input: { arrayBuffer: ArrayBuffer } | { buffer: Buffer }
  ): Promise<{ value: string; messages: unknown[] }>;
  const _default: { extractRawText: typeof extractRawText };
  export default _default;
}
