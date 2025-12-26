import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Check, Globe, ArrowRight, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface LanguageSetupProps {
    onComplete: (lang: string) => void;
}

const LANGUAGES = [
    { id: 'ko', label: 'Korean', native: '한국어', flag: '🇰🇷' },
    { id: 'en', label: 'English', native: 'English', flag: '🇺🇸' },
    { id: 'ja', label: 'Japanese', native: '日本語', flag: '🇯🇵' },
    { id: 'zh', label: 'Chinese', native: '中文', flag: '🇨🇳' },
    { id: 'es', label: 'Spanish', native: 'Español', flag: '🇪🇸' },
    { id: 'fr', label: 'French', native: 'Français', flag: '🇫🇷' },
    { id: 'de', label: 'German', native: 'Deutsch', flag: '🇩🇪' },
    { id: 'it', label: 'Italian', native: 'Italiano', flag: '🇮🇹' },
    { id: 'ru', label: 'Russian', native: 'Русский', flag: '🇷🇺' },
    { id: 'pt', label: 'Portuguese', native: 'Português', flag: '🇵🇹' },
];

export function LanguageSetup({ onComplete }: LanguageSetupProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedLangId, setSelectedLangId] = useState<string>('ko');

    // Filter languages based on search query (case-insensitive)
    const filteredLanguages = useMemo(() => {
        if (!searchQuery.trim()) return LANGUAGES;
        const query = searchQuery.toLowerCase().trim();
        return LANGUAGES.filter(lang => 
            lang.label.toLowerCase().includes(query)
        );
    }, [searchQuery]);

    // Auto-select first result when filtering
    useEffect(() => {
        if (filteredLanguages.length > 0) {
            // Keep current selection if it exists in the filtered list
            const exists = filteredLanguages.find(l => l.id === selectedLangId);
            if (!exists) {
                setSelectedLangId(filteredLanguages[0].id);
            }
        }
    }, [filteredLanguages, selectedLangId]);

    // Handle Enter key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                if (filteredLanguages.length > 0 && selectedLangId) {
                    onComplete(selectedLangId);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedLangId, filteredLanguages, onComplete]);

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-900">
            <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-100 p-8 text-center"
            >
                <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6 text-indigo-600">
                    <Globe className="w-8 h-8" />
                </div>

                <h2 className="text-2xl font-bold mb-2">언어 설정 (Language)</h2>
                <p className="text-slate-500 mb-6">
                    사용하실 주 언어를 검색하여 선택해주세요.
                </p>

                {/* Search Input */}
                <div className="relative mb-6">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                    <Input 
                        placeholder="Search language (e.g. Korean)" 
                        className="pl-10 h-12 text-lg bg-slate-50 border-slate-200 focus-visible:ring-indigo-500"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoFocus
                    />
                </div>

                <div className="space-y-2 mb-[35px] max-h-[300px] overflow-y-auto pr-[10px] custom-scrollbar pt-[0px] pb-[5px] pl-[0px] mt-[5px] mr-[5px] ml-[5px]">
                    {filteredLanguages.length === 0 ? (
                        <div className="py-8 text-slate-400 text-sm">
                            검색 결과가 없습니다.
                        </div>
                    ) : (
                        <AnimatePresence mode='popLayout'>
                            {filteredLanguages.map((lang) => (
                                <motion.button
                                    layout
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                    key={lang.id}
                                    onClick={() => setSelectedLangId(lang.id)}
                                    className={`w-full flex items-center justify-between p-[9px] rounded-lg border-2 transition-all ${
                                        selectedLangId === lang.id 
                                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm ring-1 ring-indigo-200' 
                                        : 'border-slate-100 hover:border-slate-300 hover:bg-slate-50 text-slate-600'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-[19px]">{lang.flag}</span>
                                        <div className="text-left">
                                            <div className="font-bold text-[13px] text-slate-900">{lang.native}</div>
                                            <div className={`text-[10px] ${selectedLangId === lang.id ? 'text-indigo-500' : 'text-slate-400'}`}>
                                                {lang.label}
                                            </div>
                                        </div>
                                    </div>
                                    {selectedLangId === lang.id && (
                                        <motion.div
                                            initial={{ scale: 0 }}
                                            animate={{ scale: 1 }}
                                        >
                                            <Check className="w-[17px] h-[17px] text-indigo-600" />
                                        </motion.div>
                                    )}
                                </motion.button>
                            ))}
                        </AnimatePresence>
                    )}
                </div>

                <Button 
                    size="lg" 
                    className="w-full h-12 text-lg rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => onComplete(selectedLangId)}
                    disabled={!selectedLangId || filteredLanguages.length === 0}
                >
                    시작하기
                    <ArrowRight className="w-5 h-5 ml-2" />
                </Button>

                <div className="mt-4 text-xs text-slate-400 flex items-center justify-center gap-1">
                    <span className="bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-[10px] font-mono">Enter</span>
                    키를 누르면 바로 시작합니다
                </div>
            </motion.div>
        </div>
    );
}
