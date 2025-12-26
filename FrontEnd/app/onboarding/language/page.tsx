'use client';

import { useRouter } from 'next/navigation';
import { LanguageSetup } from '@/components/onboarding/LanguageSetup';

export default function LanguageSetupPage() {
    const router = useRouter();

    return (
        <LanguageSetup
            onComplete={(lang) => {
                console.log('Language preference saved:', lang);
                router.push('/dashboard');
            }}
        />
    );
}
