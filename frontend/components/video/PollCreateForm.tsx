import React, { useState } from 'react';

interface PollCreateFormProps {
    onSubmit: (question: string, options: string[], duration: number) => void;
    onCancel: () => void;
}

const DURATIONS = [
    { label: '제한 없음', value: 0 },
    { label: '1분', value: 60 * 1000 },
    { label: '3분', value: 3 * 60 * 1000 },
    { label: '5분', value: 5 * 60 * 1000 },
    { label: '10분', value: 10 * 60 * 1000 },
];

export default function PollCreateForm({ onSubmit, onCancel }: PollCreateFormProps) {
    const [question, setQuestion] = useState('');
    const [options, setOptions] = useState(['', '']);
    const [duration, setDuration] = useState(0);

    const handleOptionChange = (index: number, value: string) => {
        const newOptions = [...options];
        newOptions[index] = value;
        setOptions(newOptions);
    };

    const addOption = () => {
        setOptions([...options, '']);
    };

    const removeOption = (index: number) => {
        if (options.length <= 2) return;
        setOptions(options.filter((_, i) => i !== index));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // 빈 옵션 제거
        const validOptions = options.map(o => o.trim()).filter(Boolean);
        if (!question.trim() || validOptions.length < 2) return;

        onSubmit(question, validOptions, duration);
    };

    return (
        <form onSubmit={handleSubmit} className="p-4 bg-white rounded-lg shadow-lg border border-black/10 w-80 absolute bottom-16 right-4 z-50">
            <h3 className="font-bold text-lg mb-4">비공개 투표 만들기</h3>

            <div className="mb-4">
                <label className="block text-sm font-medium text-black/70 mb-1">질문</label>
                <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="투표 주제를 입력하세요"
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-black/5"
                    autoFocus
                />
            </div>

            <div className="mb-4 space-y-2">
                <label className="block text-sm font-medium text-black/70 mb-1">옵션</label>
                {options.map((option, index) => (
                    <div key={index} className="flex gap-2">
                        <input
                            type="text"
                            value={option}
                            onChange={(e) => handleOptionChange(index, e.target.value)}
                            placeholder={`옵션 ${index + 1}`}
                            className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-black/5"
                        />
                        {options.length > 2 && (
                            <button
                                type="button"
                                onClick={() => removeOption(index)}
                                className="px-2 text-red-500 hover:bg-red-50 rounded"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                ))}
                <button
                    type="button"
                    onClick={addOption}
                    className="text-sm text-blue-600 hover:underline px-1"
                >
                    + 옵션 추가
                </button>
            </div>

            <div className="mb-6">
                <label className="block text-sm font-medium text-black/70 mb-2">제한 시간</label>
                <div className="flex flex-wrap gap-2">
                    {DURATIONS.map((d) => (
                        <button
                            key={d.value}
                            type="button"
                            onClick={() => setDuration(d.value)}
                            className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${duration === d.value
                                    ? 'bg-black text-white border-black'
                                    : 'bg-white text-black/60 border-black/10 hover:border-black/30'
                                }`}
                        >
                            {d.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex gap-2 justify-end mt-6">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 text-sm text-black/60 hover:bg-black/5 rounded-md transition-colors"
                >
                    취소
                </button>
                <button
                    type="submit"
                    disabled={!question.trim() || options.filter(o => o.trim()).length < 2}
                    className="px-4 py-2 text-sm bg-black text-white rounded-md hover:bg-black/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    투표 시작
                </button>
            </div>
        </form>
    );
}
