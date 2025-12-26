import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { 
    ArrowRight, CheckCircle2, Globe, Layout, 
    MessageSquare, ShieldCheck, Zap, Users, 
    Play, Mic, PenTool, Sparkles 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';

interface LandingPageProps {
    onStart: () => void;
    onLogin: () => void;
}

export function LandingPage({ onStart, onLogin }: LandingPageProps) {
    const [isLoginOpen, setIsLoginOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const handleGoogleLogin = () => {
        setIsLoading(true);
        // Simulate API call
        setTimeout(() => {
            setIsLoading(false);
            setIsLoginOpen(false);
            onLogin();
        }, 1500);
    };

    return (
        <div className="min-h-screen bg-white selection:bg-indigo-100 selection:text-indigo-900 font-sans">
            
            {/* --- Login Modal --- */}
            <Dialog open={isLoginOpen} onOpenChange={setIsLoginOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-center text-2xl font-bold mb-2">Welcome Back</DialogTitle>
                        <DialogDescription className="text-center">
                            ZoomCord 계정으로 계속하려면 로그인해주세요.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-4 py-4">
                        <Button 
                            variant="outline" 
                            className="w-full h-12 text-base font-medium relative hover:bg-slate-50 border-slate-300" 
                            onClick={handleGoogleLogin}
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <div className="w-5 h-5 border-2 border-slate-600 border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <>
                                    <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                                        <path
                                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                            fill="#4285F4"
                                        />
                                        <path
                                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                            fill="#34A853"
                                        />
                                        <path
                                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                            fill="#FBBC05"
                                        />
                                        <path
                                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                            fill="#EA4335"
                                        />
                                    </svg>
                                    Google 계정으로 계속하기
                                </>
                            )}
                        </Button>
                        <p className="text-center text-xs text-slate-500 mt-2">
                            로그인 시 <a href="#" className="underline hover:text-indigo-600">이용약관</a> 및 <a href="#" className="underline hover:text-indigo-600">개인정보처리방침</a>에 동의하게 됩니다.
                        </p>
                    </div>
                </DialogContent>
            </Dialog>

            {/* --- Navigation --- */}
            <nav className="fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-100">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">
                            Z
                        </div>
                        <span className="text-xl font-bold text-slate-900 tracking-tight">ZoomCord</span>
                    </div>

                    <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
                        <a href="#features" className="hover:text-indigo-600 transition-colors">Features</a>
                        <a href="#solutions" className="hover:text-indigo-600 transition-colors">Solutions</a>
                        <a href="#pricing" className="hover:text-indigo-600 transition-colors">Pricing</a>
                        <a href="#enterprise" className="hover:text-indigo-600 transition-colors">Enterprise</a>
                    </div>

                    <div className="flex items-center gap-3">
                        <Button className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-full px-6" onClick={() => setIsLoginOpen(true)}>
                            시작하기
                        </Button>
                    </div>
                </div>
            </nav>

            {/* --- Hero Section --- */}
            <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden">
                <div className="max-w-7xl mx-auto px-6 relative z-10">
                    <div className="text-center max-w-4xl mx-auto">
                        <motion.div 
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5 }}
                        >
                            <Badge className="mb-6 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200 px-4 py-1.5 text-sm rounded-full">
                                <Sparkles className="w-3.5 h-3.5 mr-2 inline-block" />
                                2024년 최고의 AI 협업 플랫폼 선정
                            </Badge>
                            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-slate-900 mb-8 leading-[1.1]">
                                비즈니스 커뮤니케이션을<br/>
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-violet-600">
                                    완결 짓는 AI 파트너
                                </span>
                            </h1>
                            <p className="text-xl text-slate-600 mb-10 leading-relaxed max-w-2xl mx-auto">
                                단순한 화상 회의가 아닙니다. <br className="hidden md:block"/>
                                실시간 AI 통역, 무결점 아카이빙, 그리고 Miro급 화이트보드가<br className="hidden md:block"/>
                                당신의 비즈니스를 완벽하게 서포트합니다.
                            </p>
                            
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                                <Button size="lg" className="h-14 px-8 text-lg rounded-full bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200" onClick={() => setIsLoginOpen(true)}>
                                    시작하기 <ArrowRight className="ml-2 w-5 h-5" />
                                </Button>
                               
                            </div>
                        </motion.div>
                    </div>

                    {/* Dashboard Preview Image */}
                    <motion.div 
                        initial={{ opacity: 0, y: 100 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.2 }}
                        className="mt-20 relative mx-auto max-w-6xl"
                    >
                        <div className="rounded-2xl border-4 border-slate-900/5 shadow-2xl overflow-hidden bg-slate-900 aspect-[16/9] relative group">
                             {/* Abstract UI Representation */}
                            <img 
                                src="https://images.unsplash.com/photo-1750768145390-f0ad18d3e65b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjBidXNpbmVzcyUyMG1lZXRpbmclMjBpbnRlcmZhY2UlMjBkYXNoYm9hcmQlMjBmdXR1cmlzdGljfGVufDF8fHx8MTc2NjM4MzQ5NHww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
                                alt="Platform Dashboard"
                                className="w-full h-full object-cover opacity-90 transition-transform duration-700 group-hover:scale-105"
                            />
                            
                            {/* Floating UI Elements (Parallax feel) */}
                            <div className="absolute top-8 left-8 bg-white/10 backdrop-blur-md border border-white/20 p-4 rounded-xl shadow-xl animate-in slide-in-from-left duration-1000">
                                <div className="flex items-center gap-3 text-white mb-2">
                                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                                    <span className="text-sm font-medium">AI Moderator Active</span>
                                </div>
                                <div className="text-xs text-slate-300">Translating: Korean → English (Latency 12ms)</div>
                            </div>

                            <div className="absolute bottom-8 right-8 bg-white p-4 rounded-xl shadow-2xl max-w-sm border border-slate-100 animate-in slide-in-from-bottom duration-1000 delay-300">
                                <div className="flex items-center gap-3 mb-2">
                      
                                </div>
                                <p className="text-xs text-slate-500">
                  
                                </p>
                            </div>
                        </div>

                        {/* Background Glow */}
                        <div className="absolute -inset-4 bg-gradient-to-r from-indigo-500 to-purple-500 opacity-20 blur-3xl -z-10 rounded-[3rem]" />
                    </motion.div>

                    {/* Trusted By */}
                    <div className="mt-20 text-center">
                        <p className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-8">Trusted by industry leaders</p>
                        <div className="flex flex-wrap justify-center gap-8 md:gap-16 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
                            {['Acme Corp', 'GlobalTech', 'Nebula', 'Velocity', 'FoxRun'].map((logo, i) => (
                                <span key={i} className="text-xl font-bold text-slate-800">{logo}</span>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* --- Features Section (4 Identity Pillars) --- */}
            <section id="features" className="py-24 bg-slate-50 relative overflow-hidden">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="text-center max-w-3xl mx-auto mb-20">
                        <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
                            비즈니스 커뮤니케이션의 <br/>새로운 표준
                        </h2>
                        <p className="text-lg text-slate-600">
                            단순한 연결을 넘어, 성과를 만들어내는 4가지 핵심 가치를 제공합니다.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-8 lg:gap-12">
                        {/* Feature 1: AI Moderator */}
                        <FeatureCard 
                            icon={<MessageSquare className="w-8 h-8 text-white" />}
                            color="bg-indigo-500"
                            title="지능형 중재자 (Active Moderator)"
                            desc="AI가 대화의 맥락을 이해하여 실시간으로 통번역하고, 비즈니스 매너와 팩트 오류를 즉각 교정해 주는 능동적인 파트너입니다."
                            badge="Real-time AI"
                        />
                        
                        {/* Feature 2: Perfect Archivist */}
                        <FeatureCard 
                            icon={<ShieldCheck className="w-8 h-8 text-white" />}
                            color="bg-emerald-500"
                            title="무결점 기록소 (Perfect Archivist)"
                            desc="네트워크가 끊겨도 걱정 없습니다. AWS 하이브리드 아키텍처로 대���와 음성을 실시간 저장하고, 회의 종료 시 자동 자산화합니다."
                            badge="Zero Data Loss"
                        />

                        {/* Feature 3: Visual Workspace */}
                        <FeatureCard 
                            icon={<Layout className="w-8 h-8 text-white" />}
                            color="bg-blue-500"
                            title="비주얼 협업 공간 (Visual Workspace)"
                            desc="화상 회의의 피로도를 해결하는 '음성 + Miro급 화이트보드' 모드. 오디오 비주얼라이저와 함께 생각의 흐름을 시각화하세요."
                            badge="Infinite Canvas"
                        />

                        {/* Feature 4: Global Operation */}
                        <FeatureCard 
                            icon={<Globe className="w-8 h-8 text-white" />}
                            color="bg-violet-500"
                            title="글로벌 오퍼레이션 (Global Ready)"
                            desc="VPN 없이 전 세계 어디서나 옆자리처럼. 최적의 서버 자동 연결로 초실시간(Ultra-Low Latency) 소통 환경을 구현했습니다."
                            badge="Global CDN"
                        />
                    </div>
                </div>
            </section>

            {/* --- CTA Section --- */}
            <section className="py-24 relative overflow-hidden">
                <div className="absolute inset-0 bg-slate-900" />
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20" />
                <div className="absolute top-0 right-0 w-1/2 h-full bg-indigo-600/20 blur-3xl rounded-full translate-x-1/3" />

                <div className="max-w-4xl mx-auto px-6 relative z-10 text-center text-white">
                    <h2 className="text-4xl md:text-5xl font-bold mb-8 tracking-tight">
                        지금 바로, 완벽한 협업을 경험하세요.
                    </h2>
                    <p className="text-xl text-slate-300 mb-10 max-w-2xl mx-auto">
                        더 이상 회의록 작성에 시간을 낭비하지 마세요. <br/>
                        AI 파트너가 당신의 비즈니스를 가속화합니다.
                    </p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <Button size="lg" className="h-16 px-10 text-xl rounded-full bg-white text-slate-900 hover:bg-slate-100" onClick={() => setIsLoginOpen(true)}>
                            무료로 시작하기
                        </Button>
                        <Button size="lg" variant="outline" className="h-16 px-10 text-xl rounded-full border-slate-600 text-[rgb(0,0,0)] hover:bg-white/10 hover:text-white hover:border-white">
                            도입 문의하기
                        </Button>
                    </div>
                    <p className="mt-8 text-sm text-slate-400">
                        * 신용카드 없이 14일 동안 무료 체험 가능합니다.
                    </p>
                </div>
            </section>

            {/* --- Footer --- */}
            <footer className="bg-slate-50 border-t border-slate-200 py-12 text-slate-500 text-sm">
                <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
                    <div>
                        <div className="font-bold text-slate-900 mb-4">Product</div>
                        <ul className="space-y-2">
                            <li><a href="#" className="hover:text-indigo-600">Features</a></li>
                            <li><a href="#" className="hover:text-indigo-600">Enterprise</a></li>
                            <li><a href="#" className="hover:text-indigo-600">Security</a></li>
                            <li><a href="#" className="hover:text-indigo-600">Pricing</a></li>
                        </ul>
                    </div>
                    <div>
                        <div className="font-bold text-slate-900 mb-4">Resources</div>
                        <ul className="space-y-2">
                            <li><a href="#" className="hover:text-indigo-600">Documentation</a></li>
                            <li><a href="#" className="hover:text-indigo-600">API Reference</a></li>
                            <li><a href="#" className="hover:text-indigo-600">Community</a></li>
                            <li><a href="#" className="hover:text-indigo-600">Blog</a></li>
                        </ul>
                    </div>
                    <div>
                        <div className="font-bold text-slate-900 mb-4">Company</div>
                        <ul className="space-y-2">
                            <li><a href="#" className="hover:text-indigo-600">About</a></li>
                            <li><a href="#" className="hover:text-indigo-600">Careers</a></li>
                            <li><a href="#" className="hover:text-indigo-600">Legal</a></li>
                            <li><a href="#" className="hover:text-indigo-600">Contact</a></li>
                        </ul>
                    </div>
                    <div>
                        <div className="font-bold text-slate-900 mb-4">Connect</div>
                        <ul className="space-y-2">
                            <li><a href="#" className="hover:text-indigo-600">Twitter</a></li>
                            <li><a href="#" className="hover:text-indigo-600">GitHub</a></li>
                            <li><a href="#" className="hover:text-indigo-600">Discord</a></li>
                            <li><a href="#" className="hover:text-indigo-600">LinkedIn</a></li>
                        </ul>
                    </div>
                </div>
                <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between pt-8 border-t border-slate-200">
                    <div>&copy; 2024 ZoomCord Inc. All rights reserved.</div>
                    <div className="flex gap-4 mt-4 md:mt-0">
                        <a href="#" className="hover:text-indigo-600">Privacy Policy</a>
                        <a href="#" className="hover:text-indigo-600">Terms of Service</a>
                    </div>
                </div>
            </footer>
        </div>
    );
}

function FeatureCard({ icon, title, desc, color, badge }: any) {
    return (
        <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm hover:shadow-xl transition-shadow duration-300 relative group overflow-hidden">
            <div className={`w-14 h-14 rounded-2xl ${color} flex items-center justify-center shadow-lg mb-6 group-hover:scale-110 transition-transform duration-300`}>
                {icon}
            </div>
            {badge && (
                <div className="absolute top-8 right-8 px-3 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded-full uppercase tracking-wider">
                    {badge}
                </div>
            )}
            <h3 className="text-xl font-bold text-slate-900 mb-3 group-hover:text-indigo-600 transition-colors">
                {title}
            </h3>
            <p className="text-slate-600 leading-relaxed">
                {desc}
            </p>
            <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500 to-transparent scale-x-0 group-hover:scale-x-100 transition-transform duration-500" />
        </div>
    );
}