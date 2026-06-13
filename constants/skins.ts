export interface Skin {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  xpToUnlock: number;
}

export const skins: Skin[] = [
  { id: 'cream', name: 'Cream', primary: '#E8DCC8', secondary: '#A89070', xpToUnlock: 0 },
  { id: 'plum', name: 'Plum', primary: '#C4A0E0', secondary: '#8B5FB8', xpToUnlock: 500 },
  { id: 'moss', name: 'Moss', primary: '#8BBF96', secondary: '#557A64', xpToUnlock: 1200 },
  { id: 'terra', name: 'Terra', primary: '#D4906A', secondary: '#8E5A3E', xpToUnlock: 2000 },
  { id: 'mist', name: 'Mist', primary: '#8AACCF', secondary: '#506B86', xpToUnlock: 3000 },
  { id: 'midnight', name: 'Midnight', primary: '#3A332A', secondary: '#1F1C18', xpToUnlock: 5000 },
];
