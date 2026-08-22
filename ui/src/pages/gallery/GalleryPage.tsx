// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useState } from 'react'
import { usePageEntrance } from '@/motion/useEntrance'
import { PageHead, Panel, Tabs } from '@/components/layout'
import { Badge, Bar, Button, Dot, Empty, Kpi } from '@/components/primitives'
import { FieldShell, Input, Select, Slider, Switch, Textarea } from '@/components/form'
import { Modal } from '@/components/overlay'
import { NumberTicker } from '@/components/NumberTicker'
import { toast } from '@/stores/toastStore'

const GALLERY_TABS: { id: 'a' | 'b' | 'c'; label: string; idx: string }[] = [
  { id: 'a', label: '模型', idx: '01' },
  { id: 'b', label: '训练', idx: '02' },
  { id: 'c', label: '优化器', idx: '03' },
]

/* 设计实验室 (Developer-Only Design Lab): 三主题下逐一目检所有基础组件与交互态 */
export default function GalleryPage() {
  const ref = usePageEntrance()
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a')
  const [on, setOn] = useState(true)
  const [off, setOff] = useState(false)
  const [dim, setDim] = useState(32)
  const [modal, setModal] = useState(false)
  const [tick, setTick] = useState(87.3)

  return (
    <div ref={ref}>
      <PageHead
        idx="DEV · LAB"
        tag="DESIGN SYSTEM LAB"
        lines={[{ text: 'DESIGN' }, { text: 'LABORATORY', outline: true }]}
        sub="开发者专用设计实验室 —— 切换顶栏主题（Warm Gray / Obsidian / Slate）与动效档位，检验组件状态规范。"
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 16 }}>
        <Panel title="按钮 / 徽标 / 状态点" idx="01" panelId="SPEC-A1" hoverable>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <Button variant="primary" onClick={() => toast.ok('点火序列启动', 'IGNITE')}>
              ▶ 启动训练
            </Button>
            <Button>保存预设</Button>
            <Button variant="danger" onClick={() => toast.err('仅为样式演示', 'ABORT')}>
              ■ 终止
            </Button>
            <Button size="sm">SM 按钮</Button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
            <Badge tone="accent">RUNNING</Badge>
            <Badge tone="ok">DONE</Badge>
            <Badge tone="warn">QUEUED</Badge>
            <Badge tone="danger">FAILED</Badge>
            <Badge>DRAFT</Badge>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Dot tone="ok" pulse /> <Dot tone="accent" /> <Dot tone="warn" /> <Dot tone="danger" /> <Dot />
          </div>
        </Panel>

        <Panel title="表单控件" idx="02" panelId="SPEC-B2" hoverable>
          <div style={{ display: 'grid', gap: 12 }}>
            <FieldShell label="输出名称" en="OUTPUT">
              <Input defaultValue="mizuki_v3" />
            </FieldShell>
            <FieldShell label="优化器" en="OPTIMIZER">
              <Select
                defaultValue="AdamW8bit"
                options={['AdamW8bit', 'Prodigy', 'Lion', 'Muon', 'Automagic++'].map((v) => ({ value: v, label: v }))}
              />
            </FieldShell>
            <FieldShell label="网络维度" en="DIM" right={<b className="lx-num">{dim}</b>}>
              <Slider min={4} max={128} step={4} value={dim} onChange={setDim} />
            </FieldShell>
            <div style={{ display: 'flex', gap: 20 }}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                <Switch checked={on} onChange={setOn} ariaLabel="梯度检查点" /> 梯度检查点
              </span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                <Switch checked={off} onChange={setOff} ariaLabel="EMA" /> EMA 权重
              </span>
            </div>
            <FieldShell label="备注" en="NOTES">
              <Textarea rows={2} placeholder="多行文本…" />
            </FieldShell>
          </div>
        </Panel>

        <Panel title="数据展示" idx="03" panelId="SPEC-C3" hoverable>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(120px, 100%), 1fr))', gap: 10, marginBottom: 14 }}>
            <Kpi label="LOSS" value={<NumberTicker value={tick / 1000} decimals={5} />} accent />
            <Kpi label="STEP" value="1847 / 3000" />
            <Kpi label="ETA" value="00:15:31" />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <Bar value={tick} />
            <Bar value={61.5} lg />
            <Bar value={97.5} thin />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Button size="sm" onClick={() => setTick(Math.random() * 100)}>
              随机数值
            </Button>
            <Button size="sm" onClick={() => setModal(true)}>
              打开模态
            </Button>
          </div>
        </Panel>

        <Panel title="页签 / 空态" idx="04" panelId="SPEC-D4" hoverable>
          <Tabs
            tabs={GALLERY_TABS}
            active={tab}
            onChange={setTab}
          />
          {GALLERY_TABS.map((item) => (
            <div
              key={item.id}
              id={`lx-tab-panel-${item.id}`}
              role="tabpanel"
              aria-labelledby={`lx-tab-${item.id}`}
              hidden={tab !== item.id}
            >
              {tab === item.id ? (item.id === 'a' ? (
                <Empty title="NO DATA" desc="这里是空状态样张 —— 清晰说明 + 引导操作。">
                  <Button variant="primary" size="sm">
                    + 新建
                  </Button>
                </Empty>
              ) : (
                <div style={{ padding: '20px 4px', color: 'var(--lx-dim)', fontSize: 12.5 }}>Tab「{item.id}」内容占位。</div>
              )) : null}
            </div>
          ))}
        </Panel>
      </div>

      <Modal open={modal} title="模态样张" onClose={() => setModal(false)}>
        <p style={{ marginBottom: 12, fontSize: 13, color: 'var(--lx-text)' }}>模态内容 —— Esc 或点击遮罩关闭。</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button size="sm" onClick={() => setModal(false)}>
            取消
          </Button>
          <Button variant="primary" size="sm" onClick={() => setModal(false)}>
            确认
          </Button>
        </div>
      </Modal>
    </div>
  )
}
