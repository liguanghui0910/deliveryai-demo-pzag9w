import { useCallback, useEffect, useReducer, useState } from 'react'
import i18next from 'i18next'
import { useTranslation } from 'react-i18next'
import { ClipboardList, ConciergeBell, LayoutDashboard, Menu as MenuIcon, ShoppingBasket } from 'lucide-react'
import { HomeView } from '@/components/HomeView'
import { WelcomeView } from '@/components/WelcomeView'
import { CartPanel } from '@/components/CartPanel'
import { CheckoutView } from '@/components/CheckoutView'
import { DeliveryShowcaseView } from '@/components/DeliveryShowcaseView'
import { DemoConsole } from '@/components/DemoConsole'
import { MenuView } from '@/components/MenuView'
import { OrderView } from '@/components/OrderView'
import { ServiceSheet } from '@/components/ServiceSheet'
import { TopBar } from '@/components/TopBar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useElderlyMode } from '@/hooks/useElderlyMode'
import { readStoredNickname, rememberNickname, useCollabSession } from '@/hooks/useCollabSession'
import { initialViewFromHash, useViewRoute } from '@/hooks/useViewRoute'
import { orderReducer, initialState } from '@/state/orderReducer'
import { products } from '@/data/menu'
import { money } from '@/lib/utils'
import type { AppState, ViewName } from '@/types'

function createInitialState(): AppState {
  const search = new URLSearchParams(window.location.search)
  const requestedView = initialViewFromHash()

  // preview=menu：预置一桌带购物车的点餐态，供设计/截图预览
  if (search.get('preview') === 'menu') {
    const product = products[2]
    const spec = [i18next.t('menu.option.full'), i18next.t('menu.option.original')].join(' · ')
    return {
      ...initialState,
      table: 'A08',
      view: 'menu',
      cart: [{ uid: 'preview-item', productId: product.id, name: i18next.t(product.name), price: product.price, quantity: 1, image: product.image, spec, orderedBy: '姚乾' }],
      lastMessage: initialState.lastMessage,
    }
  }

  // 交付过程展示页为独立顶层视图，深链接直达时无需桌台上下文（REQ-007.1）
  if (requestedView === 'showcase') {
    return { ...initialState, view: requestedView }
  }

  // 深链接：直接以 #/welcome、#/menu 等地址打开时，先绑定示例桌台再进入对应视图
  if (requestedView && requestedView !== 'home') {
    return { ...initialState, table: 'A08', view: requestedView }
  }

  return initialState
}

export default function App() {
  const { t, i18n } = useTranslation()
  const [state, dispatch] = useReducer(orderReducer, undefined, createInitialState)
  const { enabled: elderly, toggle: toggleElderly } = useElderlyMode()
  // 本端昵称身份：沿用本端已确认昵称，否则取默认昵称（深链接与刷新时同样可用）
  const [nickname, setNickname] = useState(() => readStoredNickname(i18next.t('collab.default_nickname')))
  const [serviceOpen, setServiceOpen] = useState(false)
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const cartTotal = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const waitingServices = state.services.filter((service) => service.status === 'waiting').length

  const collab = useCollabSession({ dispatch, state, nickname: state.table ? nickname : null })

  // 视图 ↔ URL hash 双向同步；未绑定桌台时只有 home 与 showcase 可达，其余地址回落到 home
  const canView = useCallback((view: ViewName) => view === 'home' || view === 'showcase' || !!state.table, [state.table])
  const navigate = useCallback((view: ViewName) => dispatch({ type: 'SET_VIEW', view }), [])
  useViewRoute(state.view, { onNavigate: navigate, canView })

  useEffect(() => {
    document.documentElement.lang = i18n.language === 'zh' ? 'zh-CN' : 'en'
    document.title = t('common.title')
    const metaDesc = document.querySelector('meta[name="description"]')
    if (metaDesc) metaDesc.setAttribute('content', t('common.meta_desc'))
    try {
      localStorage.setItem('i18nextLng', i18n.language)
    } catch {
      // localStorage 不可用时降级为内存态，不报错不阻塞
    }
  }, [i18n.language, t])

  const changeView = (view: ViewName) => dispatch({ type: 'SET_VIEW', view })
  const submitOrder = () => {
    collab.submitOrder()
    setCartOpen(false)
  }
  const toggleLanguage = () => {
    i18n.changeLanguage(i18n.language === 'zh' ? 'en' : 'zh')
  }
  const handleToggleElderly = () => {
    toggleElderly()
    dispatch({ type: 'SET_MESSAGE', message: elderly ? '已切换为常规模式' : '已切换为老人模式' })
  }

  // 交付过程展示页：独立地址 #/showcase，无需桌台（REQ-007.1）
  if (state.view === 'showcase') {
    return (
      <DeliveryShowcaseView
        onBack={() => changeView(state.table ? 'menu' : 'home')}
        elderly={elderly}
        onToggleElderly={handleToggleElderly}
        onToggleLanguage={toggleLanguage}
      />
    )
  }

  if (state.view === 'home' || !state.table) {
    return <HomeView onBind={(table) => dispatch({ type: 'BIND_TABLE', table })} onShowcase={() => changeView('showcase')} />
  }

  if (state.view === 'welcome') {
    return (
      <WelcomeView
        table={state.table!}
        defaultNickname={nickname}
        onEnter={(name) => {
          rememberNickname(name)
          setNickname(name)
          dispatch({ type: 'SET_VIEW', view: 'menu' })
        }}
      />
    )
  }

  return (
    <div className="min-h-screen bg-rice-100 paper-noise">
      <TopBar
        table={state.table}
        view={state.view}
        serviceCount={waitingServices}
        language={i18n.language}
        elderly={elderly}
        syncState={collab.syncState}
        selfName={collab.selfNickname ?? nickname}
        onToggleLanguage={toggleLanguage}
        onToggleElderly={handleToggleElderly}
        onView={changeView}
        onService={() => setServiceOpen(true)}
        onConsole={() => setConsoleOpen(true)}
        onRefreshSync={collab.refresh}
        onShowcase={() => changeView('showcase')}
      />

      {/* 协同不可用时的可感知提示：主链路仍可单机演示（REQ-008.5） */}
      {collab.syncState === 'offline' && (
        <div className="mx-auto max-w-7xl px-4 pt-4 lg:px-6">
          <p className="rounded-2xl bg-amber-100 px-4 py-3 text-xs font-bold text-charcoal-700">{t('collab.unavailable_desc')}</p>
        </div>
      )}

      {state.view === 'menu' && (
        <main className="mx-auto grid max-w-7xl gap-6 px-4 py-5 pb-28 lg:grid-cols-3 lg:px-6 lg:py-7 lg:pb-8">
          <div className="lg:col-span-2">
            <MenuView diners={state.diners} soldOut={state.soldOut} selfName={collab.selfNickname ?? undefined} onAdd={collab.addItem} />
          </div>
          <aside className="hidden lg:block">
            <div className="sticky top-28">
              <CartPanel items={state.cart} onQuantity={collab.changeQuantity} onSubmit={submitOrder} available={collab.available} selfMemberId={collab.selfMemberId} onAck={collab.acknowledge} />
              <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-100/70 p-4 text-sm text-charcoal-700">
                <p className="font-bold">{t('common.collab_title')}</p>
                <p className="mt-1 leading-6 text-charcoal-500">{t('common.collab_desc')}</p>
              </div>
            </div>
          </aside>
        </main>
      )}

      {state.view === 'order' && (
        <OrderView
          items={state.orderItems}
          stage={state.orderStage}
          onAddMore={() => changeView('menu')}
          onCancel={collab.cancelOrderItem}
          onCheckout={() => changeView('checkout')}
        />
      )}

      {state.view === 'checkout' && (
        <CheckoutView items={state.orderItems} paid={state.paid} onPay={collab.pay} onBack={() => changeView('order')} />
      )}

      <ServiceSheet open={serviceOpen} requests={state.services} onOpenChange={setServiceOpen} onCall={(service) => dispatch({ type: 'CALL_SERVICE', service })} />
      <DemoConsole
        open={consoleOpen}
        table={state.table}
        stage={state.orderStage}
        soldOut={state.soldOut}
        services={state.services}
        onOpenChange={setConsoleOpen}
        onStage={collab.setStage}
        onSoldOut={(productId) => dispatch({ type: 'TOGGLE_SOLD_OUT', productId })}
        onRespond={() => dispatch({ type: 'RESPOND_SERVICES' })}
        onReset={() => { dispatch({ type: 'RESET' }); setConsoleOpen(false) }}
      />

      <Dialog open={cartOpen} onOpenChange={setCartOpen}>
        <DialogContent title={t('cart.dialog_title')}>
          <div className="mt-5"><CartPanel compact items={state.cart} onQuantity={collab.changeQuantity} onSubmit={submitOrder} available={collab.available} selfMemberId={collab.selfMemberId} onAck={collab.acknowledge} /></div>
        </DialogContent>
      </Dialog>

      <div className="fixed bottom-20 left-1/2 z-30 -translate-x-1/2 lg:hidden">
        {state.view === 'menu' && state.cart.length > 0 && (
          <Button onClick={() => setCartOpen(true)} className="h-12 rounded-full px-5 shadow-float">
            <span className="relative"><ShoppingBasket size={19} /><span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-xs text-charcoal-900">{state.cart.length}</span></span>
            {t('common.view_cart')} · {money(cartTotal)}
          </Button>
        )}
      </div>

      <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-30 grid grid-cols-4 border-t border-charcoal-900/5 bg-white/95 px-2 pt-2 backdrop-blur lg:hidden">
        <MobileNav active={state.view === 'menu'} icon={MenuIcon} label={t('common.nav_menu')} onClick={() => changeView('menu')} />
        <MobileNav active={state.view === 'order'} icon={ClipboardList} label={t('common.nav_order')} onClick={() => changeView('order')} />
        <MobileNav active={serviceOpen} icon={ConciergeBell} label={t('common.nav_service')} badge={waitingServices} onClick={() => setServiceOpen(true)} />
        <MobileNav active={consoleOpen} icon={LayoutDashboard} label={t('common.nav_demo')} onClick={() => setConsoleOpen(true)} />
      </nav>

      <div className="pointer-events-none fixed left-1/2 top-24 z-40 -translate-x-1/2 rounded-full bg-charcoal-900/90 px-4 py-2 text-xs font-semibold text-white shadow-float">
        {state.lastMessage}
      </div>
    </div>
  )
}

function MobileNav({ active, icon: Icon, label, badge, onClick }: { active: boolean; icon: typeof MenuIcon; label: string; badge?: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`relative flex flex-col items-center gap-1 rounded-xl py-2 text-xs font-semibold transition ${active ? 'bg-chili-50 text-chili-500' : 'text-charcoal-500'}`}>
      <Icon size={20} />{label}{badge ? <span className="absolute right-4 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-chili-500 px-1 text-white">{badge}</span> : null}
    </button>
  )
}
