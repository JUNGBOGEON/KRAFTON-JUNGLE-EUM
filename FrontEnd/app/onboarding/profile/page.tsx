'use client';

import { useRouter } from 'next/navigation';
import { ProfileSetup } from '@/components/onboarding/ProfileSetup';
import { useApp } from '@/providers/AppProvider';

export default function ProfileSetupPage() {
    const router = useRouter();
    const { setUserProfile } = useApp();

    return (
        <ProfileSetup
            onComplete={(profile) => {
                setUserProfile(profile);
                router.push('/onboarding/language');
            }}
        />
    );
}
