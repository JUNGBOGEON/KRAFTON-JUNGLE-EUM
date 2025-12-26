import React, { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Globe, Briefcase } from 'lucide-react';

interface AuthPageProps {
    onLogin: () => void;
}

export function AuthPage({ onLogin }: AuthPageProps) {
    const [isLogin, setIsLogin] = useState(true);
    const [lang, setLang] = useState('ko');

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
            <div className="absolute top-10 left-10 flex items-center gap-2">
                 <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                    <Briefcase className="text-white h-5 w-5" />
                 </div>
                 <span className="font-bold text-xl text-slate-800">GlobalConnect</span>
            </div>

            <Card className="w-full max-w-md shadow-xl border-slate-200">
                <CardHeader className="space-y-1">
                    <div className="flex justify-between items-center">
                        <CardTitle className="text-2xl font-bold">
                            {isLogin ? (lang === 'ko' ? '로그인' : 'Sign In') : (lang === 'ko' ? '계정 생성' : 'Create Account')}
                        </CardTitle>
                        <Button variant="ghost" size="sm" onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}>
                            <Globe className="mr-2 h-4 w-4" />
                            {lang === 'ko' ? '한국어' : 'English'}
                        </Button>
                    </div>
                    <CardDescription>
                         {lang === 'ko' ? '글로벌 비즈니스 협업을 시작하세요.' : 'Start your global business collaboration.'}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">{lang === 'ko' ? '이메일' : 'Email'}</label>
                        <Input placeholder="m@example.com" type="email" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">{lang === 'ko' ? '비밀번호' : 'Password'}</label>
                        <Input type="password" />
                    </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-4">
                    <Button className="w-full bg-indigo-600 hover:bg-indigo-700" onClick={onLogin}>
                        {isLogin ? (lang === 'ko' ? '로그인' : 'Sign In') : (lang === 'ko' ? '가입하기' : 'Sign Up')}
                    </Button>
                    <div className="text-center text-sm text-muted-foreground">
                        <button 
                            className="ml-1 underline hover:text-indigo-600 font-medium"
                            onClick={() => setIsLogin(!isLogin)}
                        >
                             {isLogin ? (lang === 'ko' ? '회원가입' : 'Sign Up') : (lang === 'ko' ? '로그인' : 'Sign In')}
                        </button>
                    </div>
                </CardFooter>
            </Card>
        </div>
    );
}
