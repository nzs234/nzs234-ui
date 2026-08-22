// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * Anima model-folder smart scan.
 * Port of legacy animaFolderScanTool: pick folder → POST /api/scan_anima_folder → write paths.
 * 歧义契约:后端给出 auto_selected 时静默应用;找到但无 auto_selected(多候选)时,
 * 必须弹出选择器由用户确认 —— 绝不擅自取首项写回。写回后标记 wizard 显式/过期/清预检。
 */
import { trainApi } from '@/api/trainApi'
import { unwrap } from '@/api/transport'
import { useTrainConfigStore } from '@/stores/configStore'
import { useWizardStore } from '@/pages/train/wizard/wizardStore'
import { toast } from '@/stores/toastStore'
import { openAnimaScanChooser, type AnimaScanComponentChoice } from './animaFolderScanUi'

export const ANIMA_SCAN_COMPONENT_META = {
  dit_model: { label: 'Anima DiT', field: 'pretrained_model_name_or_path' },
  vae: { label: 'VAE', field: 'vae' },
  qwen3: { label: 'Qwen3', field: 'qwen3' },
  llm_adapter: { label: 'LLM Adapter', field: 'llm_adapter_path' },
  t5_tokenizer: { label: 'T5 Tokenizer', field: 't5_tokenizer_path' },
} as const

const COMP_ORDER = Object.keys(ANIMA_SCAN_COMPONENT_META) as (keyof typeof ANIMA_SCAN_COMPONENT_META)[]

type ScanComponent = {
  found?: boolean
  auto_selected?: string | null
  candidates?: Array<string | { path?: string; score?: number }>
}

type ScanResult = {
  error?: string
  components?: Record<string, ScanComponent>
}

function candidatePath(c: string | { path?: string }): string {
  if (typeof c === 'string') return c
  return String(c?.path || '')
}

/** applyValues 写回,并把涉及字段标记为 wizard 显式 + files 步过期 + 清预检。返回写回的字段 key 列表。 */
function applySelections(paths: Record<string, string>): string[] {
  const values: Record<string, unknown> = {}
  const keys: string[] = []
  for (const key of COMP_ORDER) {
    const path = paths[key]
    if (!path) continue
    const fieldKey = ANIMA_SCAN_COMPONENT_META[key].field
    values[fieldKey] = path
    keys.push(fieldKey)
  }
  if (!keys.length) return []
  const typeId = useTrainConfigStore.getState().typeId
  useTrainConfigStore.getState().applyValues(values)
  useWizardStore.getState().markExplicit(typeId, keys)
  useWizardStore.getState().markStaleFrom(typeId, 'files')
  useWizardStore.getState().clearPreflight(typeId)
  return keys
}

/** Open native folder picker, scan, fill model path fields. */
export async function openAnimaFolderScanner(): Promise<void> {
  let folderPath = ''
  try {
    const payload = unwrap<Record<string, unknown>>(await trainApi.pickFile('folder', 'anima_model_root'))
    const path =
      (typeof payload === 'string' && payload) ||
      (payload && typeof payload === 'object' && (payload.path ?? payload.file ?? payload.folder))
    if (typeof path === 'string' && path) folderPath = path
  } catch (e) {
    toast.warn((e as Error).message || 'folder pick failed', 'SCAN')
    return
  }
  if (!folderPath) {
    toast.info('未选择文件夹', 'SCAN')
    return
  }

  toast.info('正在扫描模型文件夹…', 'SCAN')
  let scanResult: ScanResult
  try {
    scanResult = unwrap<ScanResult>(await trainApi.scanAnimaFolder(folderPath))
  } catch (e) {
    toast.warn((e as Error).message || '扫描请求失败', 'SCAN')
    return
  }
  if (!scanResult || scanResult.error) {
    toast.warn(scanResult?.error || '扫描失败', 'SCAN')
    return
  }

  const components = scanResult.components || {}
  const hasAny = COMP_ORDER.some((k) => components[k]?.found)
  if (!hasAny) {
    toast.info('未在该目录找到可识别的模型文件。', 'SCAN')
    return
  }

  // 高置信(auto_selected):直接采用;歧义(found && !auto_selected):交用户选择。
  const picks: Record<string, string> = {}
  const ambiguous: AnimaScanComponentChoice[] = []
  for (const k of COMP_ORDER) {
    const c = components[k]
    if (!c?.found) continue
    const auto = c.auto_selected ? String(c.auto_selected) : ''
    if (auto) {
      picks[k] = auto
      continue
    }
    const list = [...new Set((c.candidates || []).map(candidatePath).filter(Boolean))]
    if (!list.length) continue
    ambiguous.push({
      key: k,
      label: ANIMA_SCAN_COMPONENT_META[k].label,
      field: ANIMA_SCAN_COMPONENT_META[k].field,
      candidates: list,
    })
  }

  if (ambiguous.length) {
    const userPicks = await openAnimaScanChooser(ambiguous)
    if (!userPicks) return // 用户取消:不写回任何路径
    for (const [key, path] of Object.entries(userPicks)) {
      if (path) picks[key] = path
    }
  }

  const applied = applySelections(picks)
  if (!applied.length) {
    toast.warn('未能从扫描结果中确定任何路径', 'SCAN')
    return
  }
  if (ambiguous.length) {
    toast.info(`已应用 ${applied.length} 个模型路径（含手动确认项）。`, 'SCAN')
  } else {
    toast.info(`已自动填充 ${applied.length} 个模型路径。`, 'SCAN')
  }
}
