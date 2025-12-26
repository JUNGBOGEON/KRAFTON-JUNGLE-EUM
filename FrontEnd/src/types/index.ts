export interface User {
  id: string;
  name: string;
  avatar: string;
  color: string;
  language: 'ko' | 'en' | 'jp';
}

export interface Message {
  id: string;
  sender: User;
  content: string; // 원문
  translatedContent?: string; // 번역문
  timestamp: string;
  type: 'text' | 'file';
}

export interface Subtitle {
  id: string;
  senderId: string;
  senderName: string;
  originalText: string;
  translatedText: string;
  timestamp: number;
}

export interface CanvasItem {
  id: string;
  type: 'path' | 'note' | 'image' | 'ui-component';
  x: number;
  y: number;
  content?: string;
  color?: string;
  children?: string[]; // for mind map
}
