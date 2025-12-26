import React, { useEffect, useState } from 'react';
import { Subtitle } from '../../types';
import { motion, AnimatePresence } from 'framer-motion';

interface SubtitleOverlayProps {
  subtitles: Subtitle[];
  isEnabled: boolean;
}

export function SubtitleOverlay({ subtitles, isEnabled }: SubtitleOverlayProps) {
  if (!isEnabled) return null;

  return (
    <div className="absolute bottom-24 left-0 right-0 px-8 flex flex-col items-center justify-end space-y-2 pointer-events-none z-20">
      <AnimatePresence>
        {subtitles.slice(-2).map((sub) => (
          <motion.div
            key={sub.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-black/70 backdrop-blur-md px-6 py-4 rounded-xl max-w-3xl text-center"
          >
            <div className="flex items-center justify-center gap-2 mb-1">
              <span className="text-xs font-bold px-2 py-0.5 rounded text-white" style={{ backgroundColor: stringToColor(sub.senderName) }}>
                {sub.senderName}
              </span>
            </div>
            <p className="text-white text-lg font-medium leading-relaxed">
              {sub.translatedText}
            </p>
            <p className="text-gray-400 text-sm mt-1">
              {sub.originalText}
            </p>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// Helper to generate consistent colors from strings
function stringToColor(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c = (hash & 0x00ffffff).toString(16).toUpperCase();
  return '#' + '00000'.substring(0, 6 - c.length) + c;
}
