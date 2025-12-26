import React, { useState, useEffect, useRef } from 'react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Globe, Send, RefreshCw, Languages } from 'lucide-react';
import { Message } from '../../types';

interface TranslationChatProps {
    onOpenProfile?: (userName: string) => void;
}

export function TranslationChat({ onOpenProfile }: TranslationChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    { 
      id: '1', 
      sender: { id: 'u2', name: 'James', avatar: '', color: '#ef4444', language: 'en' }, 
      content: 'Hello everyone, could you please look at the design draft?',
      translatedContent: '안녕하세요 여러분, 디자인 초안 좀 봐주시겠어요?',
      timestamp: '10:00', 
      type: 'text' 
    },
    { 
        id: '2', 
        sender: { id: 'u3', name: 'Sarah', avatar: '', color: '#22c55e', language: 'en' }, 
        content: 'I think the color scheme needs some adjustment.',
        timestamp: '10:01', 
        type: 'text' 
      },
  ]);
  const [inputText, setInputText] = useState('');
  const [translateMode, setTranslateMode] = useState(false);
  const [previewText, setPreviewText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Simulate real-time translation preview
  useEffect(() => {
    if (translateMode && inputText.length > 0) {
      // Mock translation logic: simple append for demo
      const timer = setTimeout(() => {
        setPreviewText(`(EN) ${inputText} [Translated]`);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setPreviewText('');
    }
  }, [inputText, translateMode]);

  const handleSend = () => {
    if (!inputText.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      sender: { id: 'me', name: 'Me', avatar: '', color: '#3b82f6', language: 'ko' },
      content: inputText,
      // If translate mode is on, we simulate sending the translated version as primary or handling it in backend
      // Here we act as if we sent it
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'text'
    };

    setMessages([...messages, newMessage]);
    setInputText('');
    setPreviewText('');
  };

  const handleTranslateMessage = (id: string) => {
     setMessages(messages.map(m => {
         if(m.id === id && !m.translatedContent) {
             // Mock translation
             return { ...m, translatedContent: "색상 조합을 조금 조정해야 할 것 같아요." };
         }
         return m;
     }));
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="p-3 border-b flex items-center justify-between bg-white shadow-sm z-10">
        <span className="font-semibold text-sm">실시간 번역 채팅</span>
        <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{translateMode ? '자동 번역 ON' : '번역 OFF'}</span>
            <Button 
                variant={translateMode ? "default" : "outline"} 
                size="icon" 
                className={`h-7 w-7 ${translateMode ? 'bg-indigo-600 hover:bg-indigo-700' : ''}`}
                onClick={() => setTranslateMode(!translateMode)}
            >
                <Languages className="h-4 w-4" />
            </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4 bg-gray-50/50">
        <div className="space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.sender.id === 'me' ? 'flex-row-reverse' : ''}`}>
              <Avatar 
                className="h-8 w-8 mt-1 border cursor-pointer hover:ring-2 hover:ring-indigo-200 transition-all" 
                onClick={() => onOpenProfile && onOpenProfile(msg.sender.name)}
              >
                <AvatarFallback className="text-xs text-white" style={{ backgroundColor: msg.sender.color }}>
                  {msg.sender.name[0]}
                </AvatarFallback>
              </Avatar>
              <div className={`flex flex-col max-w-[80%] ${msg.sender.id === 'me' ? 'items-end' : 'items-start'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span 
                    className="text-xs font-bold text-gray-700 cursor-pointer hover:underline"
                    onClick={() => onOpenProfile && onOpenProfile(msg.sender.name)}
                  >
                      {msg.sender.name}
                  </span>
                  <span className="text-[10px] text-gray-400">{msg.timestamp}</span>
                </div>
                
                <div className={`p-3 rounded-lg text-sm shadow-sm relative group ${
                  msg.sender.id === 'me' 
                    ? 'bg-indigo-600 text-white rounded-tr-none' 
                    : 'bg-white border text-gray-800 rounded-tl-none'
                }`}>
                  {msg.content}
                  
                  {/* Translate Button for incoming foreign messages */}
                  {msg.sender.id !== 'me' && msg.sender.language !== 'ko' && !msg.translatedContent && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); handleTranslateMessage(msg.id); }}
                        className="absolute -right-6 bottom-0 p-1 opacity-0 group-hover:opacity-100 hover:bg-gray-200 rounded transition-all"
                        title="한국어로 번역"
                    >
                        <Globe className="h-3 w-3 text-gray-500" />
                    </button>
                  )}
                </div>

                {/* Translated Result */}
                {msg.translatedContent && (
                    <div className="mt-1 p-2 bg-indigo-50 border border-indigo-100 rounded-md text-xs text-indigo-900 w-full animate-in fade-in slide-in-from-top-1">
                        <div className="flex items-center gap-1 mb-1 text-indigo-400">
                            <RefreshCw className="h-3 w-3" /> 
                            <span className="text-[10px]">Translated</span>
                        </div>
                        {msg.translatedContent}
                    </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <div className="p-4 border-t bg-white">
        {translateMode && previewText && (
            <div className="mb-2 p-2 bg-gray-100 rounded text-xs text-gray-500 italic border-l-2 border-indigo-500">
                Preview: {previewText}
            </div>
        )}
        <div className="flex gap-2">
            <div className="relative flex-1">
                <Input 
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    placeholder={translateMode ? "한국어로 입력하면 영어로 자동 변환됩니다..." : "메시지를 입력하세요..."}
                    className="pr-10 focus-visible:ring-indigo-500"
                />
                {translateMode && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <span className="flex h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
                    </div>
                )}
            </div>
          <Button size="icon" className="bg-indigo-600 hover:bg-indigo-700" onClick={handleSend}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
