import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Navbar from '../../components/landing/Navbar';
import HeroSection from '../../components/landing/HeroSection';
import WhyMailivox from '../../components/landing/WhyMailivox';
import IntelligenceEngine from '../../components/landing/IntelligenceEngine';
import SMTPSection from '../../components/landing/SMTPSection';
import CompanyIntelligence from '../../components/landing/CompanyIntelligence';
import ExtensionSection from '../../components/landing/ExtensionSection';
import DeploymentSection from '../../components/landing/DeploymentSection';
import ArchitectureMap from '../../components/landing/ArchitectureMap';
import BuiltFor from '../../components/landing/BuiltFor';
import FeatureDeepDive from '../../components/landing/FeatureDeepDive';
import GitHubCTA from '../../components/landing/GitHubCTA';
import Footer from '../../components/landing/Footer';

export default function LandingPage() {
    const [reducedMotion, setReducedMotion] = useState(false);

    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        setReducedMotion(mq.matches);
        const handler = (e) => setReducedMotion(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    return (
        <div className="min-h-screen bg-background text-white overflow-x-hidden">
            {/* Animated Background */}
            <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
                <div className="absolute inset-0 bg-grid-pattern opacity-30" />
                {!reducedMotion && (
                    <>
                        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/20 blur-[120px] animate-blob" />
                        <div className="absolute top-[20%] right-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-500/20 blur-[120px] animate-blob animation-delay-2000" />
                        <div className="absolute bottom-[-20%] left-[20%] w-[40%] h-[40%] rounded-full bg-violet-600/20 blur-[120px] animate-blob animation-delay-4000" />
                    </>
                )}
            </div>

            {/* Content */}
            <div className="relative z-10">
                <Navbar />
                <main>
                    <HeroSection reducedMotion={reducedMotion} />
                    <WhyMailivox />
                    <IntelligenceEngine reducedMotion={reducedMotion} />
                    <SMTPSection reducedMotion={reducedMotion} />
                    <CompanyIntelligence reducedMotion={reducedMotion} />
                    <ExtensionSection />
                    <DeploymentSection reducedMotion={reducedMotion} />
                    <ArchitectureMap reducedMotion={reducedMotion} />
                    <BuiltFor />
                    <FeatureDeepDive />
                    <GitHubCTA />
                </main>
                <Footer />
            </div>
        </div>
    );
}
