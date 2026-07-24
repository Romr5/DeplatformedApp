/**
 * Custom line-icon set drawn as SVG paths.
 * From C:\5BCA\meshapp\src\icons\Icons.js with extensions for Deplatformed features.
 * All icons take { size = 22, color, strokeWidth = 1.6 } and are single-color.
 */
import React from 'react';
import Svg, { Path, Circle, Line, Rect } from 'react-native-svg';

const base = (size) => ({ width: size, height: size, viewBox: '0 0 24 24' });

export const IconChats = ({ size = 22, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Path
      d="M4 6.5C4 5.12 5.12 4 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4.2 3.3c-.4.3-1 0-1-.5V16h-.3A2.5 2.5 0 0 1 2 13.5"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    />
    <Circle cx="8.3" cy="10" r="0.9" fill={color} />
    <Circle cx="12" cy="10" r="0.9" fill={color} />
    <Circle cx="15.7" cy="10" r="0.9" fill={color} />
  </Svg>
);

export const IconRooms = ({ size = 22, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M3.5 11.5 12 4l8.5 7.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M5.5 10v8A1.5 1.5 0 0 0 7 19.5h10a1.5 1.5 0 0 0 1.5-1.5v-8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M10 19.5v-5h4v5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconBoard = ({ size = 22, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Rect x="5" y="4.5" width="14" height="16" rx="2" stroke={color} strokeWidth={strokeWidth} />
    <Path d="M9 4.5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="8" y1="10" x2="16" y2="10" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="8" y1="13.3" x2="16" y2="13.3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="8" y1="16.6" x2="13" y2="16.6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconSOS = ({ size = 22, color = '#fff', strokeWidth = 1.7 }) => (
  <Svg {...base(size)} fill="none">
    <Path
      d="M12 3 13.6 8.2 19 6.6 16 11l5 2.5-5.5 1.2L17 20l-5-3.6L7 20l1.5-5.3L3 13.5 8 11 5 6.6l5.4 1.6L12 3Z"
      stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round"
    />
    <Circle cx="12" cy="12.3" r="2.1" fill={color} />
  </Svg>
);

export const IconRadar = ({ size = 22, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth={strokeWidth} opacity={0.35} />
    <Circle cx="12" cy="12" r="5" stroke={color} strokeWidth={strokeWidth} opacity={0.6} />
    <Path d="M12 12 17 7.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Circle cx="12" cy="12" r="1.4" fill={color} />
  </Svg>
);

export const IconSearch = ({ size = 20, color = '#fff', strokeWidth = 1.7 }) => (
  <Svg {...base(size)} fill="none">
    <Circle cx="10.5" cy="10.5" r="6" stroke={color} strokeWidth={strokeWidth} />
    <Line x1="15" y1="15" x2="20" y2="20" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconGear = ({ size = 20, color = '#fff', strokeWidth = 1.7 }) => (
  <Svg {...base(size)} fill="none">
    <Path
      d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    />
    <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={strokeWidth} />
  </Svg>
);

export const IconPlus = ({ size = 22, color = '#fff', strokeWidth = 2 }) => (
  <Svg {...base(size)} fill="none">
    <Line x1="12" y1="5" x2="12" y2="19" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="5" y1="12" x2="19" y2="12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconSend = ({ size = 20, color = '#fff', strokeWidth = 1.7 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M4 12 20 4l-6 16-2.5-6.5L4 12Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
  </Svg>
);

export const IconShield = ({ size = 18, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M12 3 19 5.5v5c0 5-3 8.3-7 9.5-4-1.2-7-4.5-7-9.5v-5L12 3Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    <Path d="M9 12l2 2 4-4.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconLock = ({ size = 16, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Rect x="5" y="10.5" width="14" height="9" rx="2" stroke={color} strokeWidth={strokeWidth} />
    <Path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Circle cx="12" cy="14.7" r="1.1" fill={color} />
  </Svg>
);

export const IconSatellite = ({ size = 40, color = '#fff', strokeWidth = 1.4 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M4 15c3-3 8-3 11 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Path d="M2 12c4-4 11-4 15 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" opacity={0.5} />
    <Circle cx="16" cy="16" r="1.6" fill={color} />
    <Path d="M16 16 20.5 20.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Path d="M18.5 18.5 20 17" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconCheckDouble = ({ size = 14, color = '#fff', strokeWidth = 2 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M2 12.5 6 16l6.5-8.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M9 12.5 12.5 16 19 7.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconCheck = ({ size = 16, color = '#fff', strokeWidth = 2 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M4 12.5 9 17.5 20 6.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconBack = ({ size = 22, color = '#fff', strokeWidth = 1.8 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M15 5 8 12l7 7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconDoor = ({ size = 18, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Rect x="6" y="3" width="12" height="18" rx="1.5" stroke={color} strokeWidth={strokeWidth} />
    <Circle cx="14.5" cy="12" r="1" fill={color} />
  </Svg>
);

export const IconPeople = ({ size = 18, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Circle cx="9" cy="8" r="3" stroke={color} strokeWidth={strokeWidth} />
    <Path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Circle cx="16.5" cy="9" r="2.3" stroke={color} strokeWidth={strokeWidth} opacity={0.7} />
    <Path d="M14.8 19c.3-2.2 1.8-3.8 3.7-4.3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" opacity={0.7} />
  </Svg>
);

export const IconMedical = ({ size = 22, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Rect x="3.5" y="6.5" width="17" height="12" rx="2" stroke={color} strokeWidth={strokeWidth} />
    <Line x1="12" y1="9.5" x2="12" y2="15.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="9" y1="12.5" x2="15" y2="12.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconBox = ({ size = 22, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M4 8.5 12 4l8 4.5-8 4.5-8-4.5Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    <Path d="M4 8.5v7L12 20l8-4.5v-7" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    <Line x1="12" y1="13" x2="12" y2="20" stroke={color} strokeWidth={strokeWidth} />
  </Svg>
);

export const IconTrash = ({ size = 18, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconKey = ({ size = 18, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Circle cx="8" cy="12" r="5" stroke={color} strokeWidth={strokeWidth} />
    <Path d="M13 12h8M17 12v3M20 12v2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconUser = ({ size = 20, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth={strokeWidth} />
    <Path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconBroadcast = ({ size = 20, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Circle cx="12" cy="12" r="2" fill={color} />
    <Path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconMapPin = ({ size = 18, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M12 21s-7-6.5-7-11.5a7 7 0 1 1 14 0c0 5-7 11.5-7 11.5Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <Circle cx="12" cy="9.5" r="2.5" stroke={color} strokeWidth={strokeWidth} />
  </Svg>
);

export const IconClose = ({ size = 18, color = '#fff', strokeWidth = 2 }) => (
  <Svg {...base(size)} fill="none">
    <Line x1="6" y1="6" x2="18" y2="18" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="6" y1="18" x2="18" y2="6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconRefresh = ({ size = 18, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M4 12a8 8 0 0 1 14.9-4M20 12a8 8 0 0 1-14.9 4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Path d="M19 4v4h-4M5 20v-4h4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconCopy = ({ size = 16, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Rect x="8" y="8" width="12" height="12" rx="2" stroke={color} strokeWidth={strokeWidth} />
    <Path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconMic = ({ size = 18, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Rect x="9" y="3" width="6" height="11" rx="3" stroke={color} strokeWidth={strokeWidth} />
    <Path d="M5 10a7 7 0 0 0 14 0M12 18v3M8 21h8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconCamera = ({ size = 18, color = '#fff', strokeWidth = 1.6 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    <Circle cx="12" cy="13" r="4" stroke={color} strokeWidth={strokeWidth} />
  </Svg>
);

export const IconMap = ({ size = 20, color = '#fff', strokeWidth = 1.8 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <Line x1="9" y1="3" x2="9" y2="18" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="15" y1="6" x2="15" y2="21" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconRadioTower = ({ size = 20, color = '#fff', strokeWidth = 1.8 }) => (
  <Svg {...base(size)} fill="none">
    <Circle cx="12" cy="12" r="2" fill={color} />
    <Path d="M4.93 19.07a10 10 0 0 1 0-14.14M19.07 4.93a10 10 0 0 1 0 14.14M7.76 16.24a6 6 0 0 1 0-8.48M16.24 7.76a6 6 0 0 1 0 8.48" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconWifi = ({ size = 18, color = '#fff', strokeWidth = 1.8 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M12 20h.01M5 12.859a10 10 0 0 1 14 0M8.5 16.429a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 20 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconWifiOff = ({ size = 18, color = '#fff', strokeWidth = 1.8 }) => (
  <Svg {...base(size)} fill="none">
    <Line x1="1" y1="1" x2="23" y2="23" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.86M5 12.86a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconRadio = ({ size = 18, color = '#fff', strokeWidth = 1.8 }) => (
  <Svg {...base(size)} fill="none">
    <Circle cx="12" cy="12" r="2" fill={color} />
    <Path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconShieldCheck = ({ size = 18, color = '#fff', strokeWidth = 1.8 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M9 12l2 2 4-4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconCrosshair = ({ size = 20, color = '#fff', strokeWidth = 1.8 }) => (
  <Svg {...base(size)} fill="none">
    <Circle cx="12" cy="12" r="7" stroke={color} strokeWidth={strokeWidth} />
    <Line x1="12" y1="2" x2="12" y2="5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="12" y1="19" x2="12" y2="22" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="2" y1="12" x2="5" y2="12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="19" y1="12" x2="22" y2="12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconMegaphone = ({ size = 20, color = '#fff', strokeWidth = 1.8 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M3 11l15-6v14l-15-6z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M11.6 16.8L14 21" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="3" y1="11" x2="3" y2="17" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconBattery = ({ size = 20, color = '#fff', strokeWidth = 1.8 }) => (
  <Svg {...base(size)} fill="none">
    <Rect x="2" y="7" width="16" height="10" rx="2" stroke={color} strokeWidth={strokeWidth} />
    <Line x1="22" y1="11" x2="22" y2="13" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="6" y1="10" x2="6" y2="14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="10" y1="10" x2="10" y2="14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconWater = ({ size = 20, color = '#fff', strokeWidth = 1.8 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconTent = ({ size = 20, color = '#fff', strokeWidth = 1.8 }) => (
  <Svg {...base(size)} fill="none">
    <Path d="M19 20H5l7-16 7 16z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M12 4v16" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Path d="M9 20l3-7 3 7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconMoreVertical = ({ size = 20, color = '#fff', strokeWidth = 2 }) => (
  <Svg {...base(size)} fill="none">
    <Circle cx="12" cy="5" r="1.5" fill={color} />
    <Circle cx="12" cy="12" r="1.5" fill={color} />
    <Circle cx="12" cy="19" r="1.5" fill={color} />
  </Svg>
);


