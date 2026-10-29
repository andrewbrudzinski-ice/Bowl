/** Series colors for charts: CSS variables (defined per theme in globals.css) so lines stay readable in both light and dark. */
export const chartColor = (i: number) => `var(--chart-${(i % 12) + 1})`;
/** Named picks for single-series charts. */
export const CHART = { primary: chartColor(0), secondary: chartColor(1), third: chartColor(2) } as const;
