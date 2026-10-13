import Svg, { Circle, Path, Rect } from "react-native-svg";

/* Icon set ported from the web app's components/icons.tsx (24px grid). `cut` = colour of knocked-out details. */
type P = { size?: number; color: string; cut?: string };

export const IconGrid = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Rect x="3" y="3" width="8" height="8" rx="3"/><Rect x="13" y="3" width="8" height="8" rx="3"/><Rect x="3" y="13" width="8" height="8" rx="3"/><Circle cx="17" cy="17" r="4"/></Svg>
);

export const IconBriefcase = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path d="M9 3h6a2 2 0 0 1 2 2v1h2.5A2.5 2.5 0 0 1 22 8.5V11a2 2 0 0 1-2 2h-6v-1h-4v1H4a2 2 0 0 1-2-2V8.5A2.5 2.5 0 0 1 4.5 6H7V5a2 2 0 0 1 2-2Zm0 3h6V5H9v1Zm1 8h4v1.5h6.5a1.5 1.5 0 0 0 1.5-1.4V18.5A2.5 2.5 0 0 1 19.5 21h-15A2.5 2.5 0 0 1 2 18.5v-4.4a1.5 1.5 0 0 0 1.5 1.4H10V14Z"/></Svg>
);

export const IconDoc = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path d="M7 2h7l6 6v11a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Z"/><Rect x="8" y="11" width="8" height="1.8" rx=".9" fill={cut}/><Rect x="8" y="15" width="5.5" height="1.8" rx=".9" fill={cut}/><Path d="M14 2v4a2 2 0 0 0 2 2h4" opacity=".45"/></Svg>
);

export const IconChat = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path d="M8 3h10a4 4 0 0 1 4 4v5a4 4 0 0 1-3 3.87V18l-3-2h-.5A5.5 5.5 0 0 0 10 10.5V9a6 6 0 0 0-2-4.47V3Z" opacity=".55"/><Path d="M6 7h6a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4H9l-4 3v-3.13A4 4 0 0 1 2 15v-4a4 4 0 0 1 4-4Zm1 6.25a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm2.5 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm2.5 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/></Svg>
);

export const IconMore = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Rect x="3" y="3" width="8" height="8" rx="4"/><Rect x="13" y="3" width="8" height="8" rx="4"/><Rect x="3" y="13" width="8" height="8" rx="4"/><Rect x="13" y="13" width="8" height="8" rx="4" opacity=".55"/></Svg>
);

export const IconEye = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path d="M12 4.5c4.6 0 8.4 3 10 7.1a1 1 0 0 1 0 .8c-1.6 4.1-5.4 7.1-10 7.1s-8.4-3-10-7.1a1 1 0 0 1 0-.8C3.6 7.5 7.4 4.5 12 4.5Zm0 11.25a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z"/></Svg>
);

export const IconChart = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Rect x="3" y="12" width="4.5" height="9" rx="2"/><Rect x="9.75" y="7" width="4.5" height="14" rx="2"/><Rect x="16.5" y="3" width="4.5" height="18" rx="2"/></Svg>
);

export const IconFeed = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Circle cx="5.5" cy="18.5" r="2.5"/><Path d="M3 10.5a1.5 1.5 0 0 1 1.5-1.5A10.5 10.5 0 0 1 15 19.5a1.5 1.5 0 0 1-3 0A7.5 7.5 0 0 0 4.5 12 1.5 1.5 0 0 1 3 10.5Z"/><Path d="M3 4.5A1.5 1.5 0 0 1 4.5 3 16.5 16.5 0 0 1 21 19.5a1.5 1.5 0 0 1-3 0A13.5 13.5 0 0 0 4.5 6 1.5 1.5 0 0 1 3 4.5Z" opacity=".55"/></Svg>
);

export const IconSettings = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path fillRule="evenodd" d="M10.3 2.5a3.4 3.4 0 0 1 3.4 0l5.6 3.24a3.4 3.4 0 0 1 1.7 2.94v6.64a3.4 3.4 0 0 1-1.7 2.94l-5.6 3.24a3.4 3.4 0 0 1-3.4 0l-5.6-3.24A3.4 3.4 0 0 1 3 15.32V8.68a3.4 3.4 0 0 1 1.7-2.94l5.6-3.24ZM12 15.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z"/></Svg>
);

export const IconExternal = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={"none"} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></Svg>
);

export const IconThumbUp = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={"none"} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3Zm0 0 4-7a2.5 2.5 0 0 1 2.5 2.5V9h5.2a2 2 0 0 1 2 2.3l-1.2 7.5a2.5 2.5 0 0 1-2.5 2.2H7"/></Svg>
);

export const IconThumbDown = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={"none"} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M17 14V3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3Zm0 0-4 7a2.5 2.5 0 0 1-2.5-2.5V15H5.3a2 2 0 0 1-2-2.3l1.2-7.5A2.5 2.5 0 0 1 7 3h10"/></Svg>
);

export const IconCopy = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={"none"} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Rect x="8" y="8" width="13" height="13" rx="3"/><Path d="M16 8V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h2"/></Svg>
);

export const IconCheck = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={"none"} stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><Path d="m5 12.5 4.5 4.5L19 7.5"/></Svg>
);

export const IconClose = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={"none"} stroke={color} strokeWidth={2} strokeLinecap="round"><Path d="M6 6l12 12M18 6 6 18"/></Svg>
);

export const IconAlert = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path d="M10.3 2.5a3.4 3.4 0 0 1 3.4 0l5.6 3.24a3.4 3.4 0 0 1 1.7 2.94v6.64a3.4 3.4 0 0 1-1.7 2.94l-5.6 3.24a3.4 3.4 0 0 1-3.4 0l-5.6-3.24A3.4 3.4 0 0 1 3 15.32V8.68a3.4 3.4 0 0 1 1.7-2.94l5.6-3.24Z"/><Rect x="11" y="7" width="2" height="6.5" rx="1" fill={cut}/><Circle cx="12" cy="16.25" r="1.25" fill={cut}/></Svg>
);

export const IconRefresh = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={"none"} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 3v5h5M4 13a8 8 0 0 0 14.6 4.5L20 16M20 21v-5h-5"/></Svg>
);

export const IconSpark = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path d="M11 2.5c.3 0 .6.2.7.5l1.4 4.1a5 5 0 0 0 3.2 3.2l4.1 1.4a.75.75 0 0 1 0 1.4l-4.1 1.4a5 5 0 0 0-3.2 3.2l-1.4 4.1a.75.75 0 0 1-1.4 0l-1.4-4.1a5 5 0 0 0-3.2-3.2L1.6 13.1a.75.75 0 0 1 0-1.4l4.1-1.4a5 5 0 0 0 3.2-3.2L10.3 3c.1-.3.4-.5.7-.5Z"/><Path d="M19 1.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6Z" opacity=".55"/></Svg>
);

export const IconChevronRight = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={"none"} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="m9 6 6 6-6 6"/></Svg>
);

export const IconBell = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path d="M12 2a6.5 6.5 0 0 0-6.5 6.5v3.8L3.8 15.6A1 1 0 0 0 4.7 17h14.6a1 1 0 0 0 .9-1.4l-1.7-3.3V8.5A6.5 6.5 0 0 0 12 2Zm-3 16.5a3 3 0 0 0 6 0H9Z"/></Svg>
);

export const IconPause = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Rect x="3" y="3" width="18" height="18" rx="5"/><Rect x="9" y="8" width="2" height="8" rx="1" fill={cut}/><Rect x="13" y="8" width="2" height="8" rx="1" fill={cut}/></Svg>
);

export const IconPlay = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Rect x="3" y="3" width="18" height="18" rx="5"/><Path d="M10 8.5v7l5.5-3.5L10 8.5Z" fill={cut}/></Svg>
);

export const IconFilter = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h15A1.5 1.5 0 0 1 21 4.5v1.3c0 .5-.2 1-.6 1.3L15 12v7.2a1 1 0 0 1-1.5.9l-3-1.8a1 1 0 0 1-.5-.9V12L3.6 7.1A1.7 1.7 0 0 1 3 5.8V4.5Z"/></Svg>
);

export const IconUser = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Circle cx="12" cy="8" r="4"/><Path d="M4 20a8 8 0 0 1 16 0v.5a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5V20Z"/></Svg>
);

export const IconLink = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={"none"} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6"/><Path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/></Svg>
);

export const IconGlobe = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={"none"} stroke={color} strokeWidth={2}><Circle cx="12" cy="12" r="9"/><Path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z"/></Svg>
);

export const IconStar = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path d="m12 2.8 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 2.8Z"/></Svg>
);

export const IconSend = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path d="M20.6 3.4a1 1 0 0 1 .3 1.1l-5.5 15.6a1 1 0 0 1-1.8.2l-3.1-5.2-5.2-3.1a1 1 0 0 1 .2-1.8L21.1 4.7a1 1 0 0 1-.5-1.3Zm-9 10.3 2.2 3.7 3.6-10.2-5.8 6.5Z"/></Svg>
);

export const IconSearch = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={"none"} stroke={color} strokeWidth={2} strokeLinecap="round"><Circle cx="11" cy="11" r="7"/><Path d="m20 20-3.5-3.5"/></Svg>
);

export const IconPin = ({ size = 20, color, cut = "#FFFFFF" }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path d="M12 2a7.5 7.5 0 0 0-7.5 7.5c0 5.3 6.2 11.4 6.8 12a1 1 0 0 0 1.4 0c.6-.6 6.8-6.7 6.8-12A7.5 7.5 0 0 0 12 2Zm0 10.2a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4Z"/></Svg>
);
