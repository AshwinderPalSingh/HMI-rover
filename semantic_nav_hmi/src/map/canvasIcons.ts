/**
 * Icon outlines for drawing on the map canvas, extracted from lucide (ISC license,
 * https://lucide.dev) so map pins match the UI icon set. 24x24 viewBox, stroke-based.
 */

export type IconNode = [string, Record<string, string | number>][];

export const CANVAS_ICONS: Record<string, IconNode> = {
  house: [["path",{"d":"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"}],["path",{"d":"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"}]],
  park: [["path",{"d":"M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z"}],["path",{"d":"M7 16v6"}],["path",{"d":"M13 19v3"}],["path",{"d":"M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5"}]],
  road: [["circle",{"cx":"6","cy":"19","r":"3"}],["path",{"d":"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"}],["circle",{"cx":"18","cy":"5","r":"3"}]],
  building: [["path",{"d":"M12 10h.01"}],["path",{"d":"M12 14h.01"}],["path",{"d":"M12 6h.01"}],["path",{"d":"M16 10h.01"}],["path",{"d":"M16 14h.01"}],["path",{"d":"M16 6h.01"}],["path",{"d":"M8 10h.01"}],["path",{"d":"M8 14h.01"}],["path",{"d":"M8 6h.01"}],["path",{"d":"M9 22v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"}],["rect",{"x":"4","y":"2","width":"16","height":"20","rx":"2"}]],
  landmark: [["path",{"d":"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"}]],
  zone: [["path",{"d":"M5 3a2 2 0 0 0-2 2"}],["path",{"d":"M19 3a2 2 0 0 1 2 2"}],["path",{"d":"M21 19a2 2 0 0 1-2 2"}],["path",{"d":"M5 21a2 2 0 0 1-2-2"}],["path",{"d":"M9 3h1"}],["path",{"d":"M9 21h1"}],["path",{"d":"M14 3h1"}],["path",{"d":"M14 21h1"}],["path",{"d":"M3 9v1"}],["path",{"d":"M21 9v1"}],["path",{"d":"M3 14v1"}],["path",{"d":"M21 14v1"}]],
  other: [["path",{"d":"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"}],["circle",{"cx":"12","cy":"10","r":"3"}]],
  keepout: [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M4.929 4.929 19.07 19.071"}]],
};
