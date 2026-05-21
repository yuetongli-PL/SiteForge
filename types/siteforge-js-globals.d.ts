interface Error {
  [key: string]: any;
}

interface Document {
  matches(selectors: string): boolean;
}

interface Element {
  click(): void;
  href?: string;
}

interface PerformanceEntry {
  initiatorType?: string;
}

interface Window {
  SSR_RENDER_DATA?: any;
  __INITIAL_STATE__?: any;
  webpackChunkxhs_pc_web?: any;
}
