'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BarChart3, Users, TrendingUp, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function LandingPage() {
  const t = useTranslations('landing');

  const features = [
    { icon: Users, title: t('features.leadManagement'), description: t('features.leadManagementDesc') },
    { icon: TrendingUp, title: t('features.salesPipeline'), description: t('features.salesPipelineDesc') },
    { icon: BarChart3, title: t('features.analytics'), description: t('features.analyticsDesc') },
    { icon: Zap, title: t('features.daVinci'), description: t('features.daVinciDesc') },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-primary">LeadDrive CRM</h1>
          <Button variant="outline">{t('signIn')}</Button>
        </div>
      </header>

      <section className="container mx-auto px-4 py-20">
        <div className="max-w-3xl mx-auto text-center mb-16">
          <h2 className="text-5xl font-bold mb-6">{t('hero.title')}</h2>
          <p className="text-xl text-muted-foreground mb-8">
            {t('hero.subtitle')}
          </p>
          <Button size="lg">{t('hero.cta')}</Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 my-20">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title} className="p-6 text-center">
                <Icon className="w-12 h-12 text-primary mx-auto mb-4" />
                <h3 className="font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </Card>
            );
          })}
        </div>
      </section>

      <footer className="border-t py-6 text-center text-muted-foreground">
        <p>{t('footer')}</p>
      </footer>
    </div>
  );
}
