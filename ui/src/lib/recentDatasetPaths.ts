// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/* 从 train drafts + run history 收集最近数据集目录（本地，不扫盘） */

import { listRunRecords } from '@/stores/historyStore'
import { useTrainConfigStore } from '@/stores/configStore'

const DATASET_KEYS = ['train_data_dir', 'dataset_dir', 'dataset_path', 'train_data_path'] as const
const CAP = 12

export function isDatasetFolderField(key: string): boolean {
  const k = String(key || '').toLowerCase()
  return (DATASET_KEYS as readonly string[]).includes(k) || k === 'train_data_dir' || k === 'dataset_dir'
}

function pushPath(out: string[], seen: Set<string>, raw: unknown) {
  const p = String(raw ?? '').trim()
  if (!p || p.length < 2) return
  // 跳过明显占位
  if (p === './' || p === '.' || p.includes('sd-models')) return
  const key = p.replace(/[\\/]+$/, '').toLowerCase()
  if (seen.has(key)) return
  seen.add(key)
  out.push(p)
}

/** 从草稿与历史去重收集最近路径（新在前） */
export function collectRecentDatasetPaths(limit = CAP): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  try {
    const st = useTrainConfigStore.getState()
    const drafts = st.drafts || {}
    // 当前 type 优先
    const order = [st.typeId, ...Object.keys(drafts).filter((k) => k !== st.typeId)]
    for (const tid of order) {
      const bag = drafts[tid]
      if (!bag) continue
      for (const k of DATASET_KEYS) {
        pushPath(out, seen, bag[k])
        if (out.length >= limit) return out
      }
    }
  } catch {
    /* ignore */
  }

  try {
    for (const rec of listRunRecords()) {
      const cfg = rec.config || {}
      for (const k of DATASET_KEYS) {
        pushPath(out, seen, cfg[k])
        if (out.length >= limit) return out
      }
    }
  } catch {
    /* ignore */
  }

  return out
}
