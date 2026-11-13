import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Accessibility,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Languages,
  PackageCheck,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { loadDeliveryShowcase, type DeliveryShowcaseConfig } from '@/data/deliveryShowcase'

interface DeliveryShowcaseViewProps {
  onBack: () => void
  elderly: boolean
  onToggleElderly: () => void
  onToggleLanguage: () => void
}

interface ShowcaseState {
  config: DeliveryShowcaseConfig | null
  failed: boolean
}

/** 读取静态配置；异常时进入失败态，由页面提供重试入口（REQ-007.5）。 */
function attemptLoad(): ShowcaseState {
  try {
    return { config: loadDeliveryShowcase(), failed: false }
  } catch {
    return { config: null, failed: true }
  }
}

export function DeliveryShowcaseView({ onBack, elderly, onToggleElderly, onToggleLanguage }: DeliveryShowcaseViewProps) {
  const { t, i18n } = useTranslation()
  const [{ config, failed }, setState] = useState<ShowcaseState>(attemptLoad)
  const load = () => setState(attemptLoad())

  return (
    <main className="relative min-h-screen overflow-hidden bg-rice-100 paper-noise">
      <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-chili-100 blur-3xl" />
      <div className="relative mx-auto max-w-5xl px-5 py-8 lg:px-8">
        <header className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-chili-500 text-lg font-black text-white shadow-md">{t('common.brand')}</span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-extrabold text-charcoal-900 sm:text-3xl">{t('showcase.title')}</h1>
            <p className="mt-1 text-sm text-charcoal-500">{t('showcase.subtitle')}</p>
          </div>
          <Button variant="outline" size="icon" onClick={onToggleElderly} aria-label={elderly ? '切换至常规模式' : '切换至老人模式'}>
            <Accessibility size={18} className={elderly ? 'text-chili-500' : ''} />
          </Button>
          <Button variant="outline" size="sm" onClick={onToggleLanguage} aria-label={t('common.aria_lang')}>
            <Languages size={16} />{i18n.language === 'zh' ? 'EN' : '中'}
          </Button>
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft size={16} />{t('showcase.back')}
          </Button>
        </header>

        <section className="mt-6 rounded-3xl border border-white/80 bg-white/90 p-5 shadow-card sm:p-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-chili-500/20 bg-chili-50 px-3 py-1.5 text-xs font-bold text-chili-600">
            <Sparkles size={13} /> {t('showcase.requirement_label')}
          </span>
          <p className="mt-3 text-lg font-extrabold text-charcoal-900">{t('showcase.requirement_name')}</p>
          <p className="mt-1 text-xs text-charcoal-500">{t('showcase.requirement_id', { id: config?.requirementId ?? '-' })}</p>
        </section>

        {failed && (
          <section className="mt-6 rounded-3xl border border-chili-500/20 bg-white p-6 text-center shadow-card">
            <h2 className="text-lg font-extrabold text-charcoal-900">{t('showcase.load_failed_title')}</h2>
            <p className="mt-2 text-sm leading-6 text-charcoal-500">{t('showcase.load_failed_desc')}</p>
            <Button className="mt-4" onClick={load}>{t('showcase.retry')}</Button>
          </section>
        )}

        {!failed && (
          <ol className="mt-6 space-y-4">
            {(config?.nodes ?? []).map((node, index) => {
              const done = node.status === 'done'
              return (
                <li key={node.id} className="animate-rise rounded-3xl border border-white/80 bg-white/90 p-5 shadow-card" style={{ animationDelay: `${index * 40}ms` }}>
                  <div className="flex flex-wrap items-start gap-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold ${done ? 'bg-amber-400 text-charcoal-900' : 'bg-rice-200 text-charcoal-500'}`}>{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-extrabold text-charcoal-900">{t(`showcase.node.${node.id}.title`)}</h2>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${done ? 'bg-emerald-50 text-emerald-600' : 'bg-rice-200 text-charcoal-500'}`}>
                          {done ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}
                          {done ? t('showcase.status_done') : t('showcase.status_pending')}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-charcoal-500">{t(`showcase.node.${node.id}.desc`)}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {node.artifacts.map((artifact) => (
                          artifact.url ? (
                            <a
                              key={artifact.key}
                              href={artifact.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-xl border border-charcoal-900/10 bg-white px-3 py-2 text-sm font-semibold text-charcoal-900 transition hover:border-chili-500/30 hover:bg-chili-50 hover:text-chili-600"
                            >
                              <FileText size={15} />{t(`showcase.artifact.${artifact.key}`)}<ExternalLink size={13} />
                            </a>
                          ) : (
                            <span key={artifact.key} className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-charcoal-900/10 bg-rice-50 px-3 py-2 text-sm font-semibold text-charcoal-500">
                              <FileText size={15} />{t(`showcase.artifact.${artifact.key}`)}
                              <small className="text-xs">{done ? t('showcase.artifact_ready') : t('showcase.artifact_pending')}</small>
                            </span>
                          )
                        ))}
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-charcoal-500">
          <PackageCheck size={14} className="text-chili-500" />{t('showcase.footer_note')}
        </p>
      </div>
    </main>
  )
}
