// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 最近数据集目录收集（草稿 + 运行历史，纯本地，不扫盘）。
 *
 * 这是数据集输入框下方"最近用过"下拉的唯一数据源。错误模式不是崩溃而是给出
 * 垃圾建议：把 ./sd-models 之类的 schema 占位当成用户目录列出来，或者把同一个
 * 目录按大小写/尾斜杠差异重复列三遍。
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listRunRecords: vi.fn(),
  getState: vi.fn(),
}))

vi.mock('@/stores/historyStore', () => ({ listRunRecords: mocks.listRunRecords }))
vi.mock('@/stores/configStore', () => ({
  useTrainConfigStore: { getState: mocks.getState },
}))

const { collectRecentDatasetPaths, isDatasetFolderField } = await import('./recentDatasetPaths')

type Bag = Record<string, unknown>

/** 只喂草稿，历史为空。 */
function withDrafts(typeId: string, drafts: Record<string, Bag>) {
  mocks.getState.mockReturnValue({ typeId, drafts })
  mocks.listRunRecords.mockReturnValue([])
}

/** 只喂历史，草稿为空。 */
function withHistory(configs: Bag[]) {
  mocks.getState.mockReturnValue({ typeId: 'sdxl-lora', drafts: {} })
  mocks.listRunRecords.mockReturnValue(configs.map((config, i) => ({
    id: `r${i}`,
    name: `run-${i}`,
    typeId: 'sdxl-lora',
    at: 1000 + i,
    config,
  })))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getState.mockReturnValue({ typeId: 'sdxl-lora', drafts: {} })
  mocks.listRunRecords.mockReturnValue([])
})

// ─── isDatasetFolderField ────────────────────────────────────────────────────

describe('recentDatasetPaths: isDatasetFolderField', () => {
  test('四个数据集目录键都命中', () => {
    for (const key of ['train_data_dir', 'dataset_dir', 'dataset_path', 'train_data_path']) {
      expect(isDatasetFolderField(key), key).toBe(true)
    }
  })

  test('大写/混合大小写按小写比较', () => {
    expect(isDatasetFolderField('TRAIN_DATA_DIR')).toBe(true)
    expect(isDatasetFolderField('Dataset_Dir')).toBe(true)
  })

  test('输出目录之类的其它路径字段不算数据集目录', () => {
    for (const key of ['output_dir', 'reg_data_dir', 'pretrained_model_name_or_path', '']) {
      expect(isDatasetFolderField(key), key).toBe(false)
    }
  })

  test('nullish 输入不抛', () => {
    expect(isDatasetFolderField(undefined as unknown as string)).toBe(false)
    expect(isDatasetFolderField(null as unknown as string)).toBe(false)
  })
})

// ─── 草稿来源 ───────────────────────────────────────────────────────────────

describe('recentDatasetPaths: 从草稿收集', () => {
  test('当前 type 的草稿排在其它 type 之前', () => {
    withDrafts('anima-lora', {
      'sdxl-lora': { train_data_dir: 'D:/data/sdxl' },
      'anima-lora': { train_data_dir: 'D:/data/anima' },
    })
    expect(collectRecentDatasetPaths()).toEqual(['D:/data/anima', 'D:/data/sdxl'])
  })

  test('同一个草稿里四个键按 DATASET_KEYS 顺序收集', () => {
    withDrafts('sdxl-lora', {
      'sdxl-lora': {
        dataset_path: 'D:/c',
        train_data_dir: 'D:/a',
        train_data_path: 'D:/d',
        dataset_dir: 'D:/b',
      },
    })
    expect(collectRecentDatasetPaths()).toEqual(['D:/a', 'D:/b', 'D:/c', 'D:/d'])
  })

  test('当前 type 没有草稿时不影响其它 type 的收集', () => {
    withDrafts('missing-type', { 'sdxl-lora': { train_data_dir: 'D:/data/sdxl' } })
    expect(collectRecentDatasetPaths()).toEqual(['D:/data/sdxl'])
  })

  test('drafts 为 undefined 时返回空数组', () => {
    mocks.getState.mockReturnValue({ typeId: 'sdxl-lora', drafts: undefined })
    expect(collectRecentDatasetPaths()).toEqual([])
  })

  test('store 读取抛错时静默降级，不影响历史来源', () => {
    mocks.getState.mockImplementation(() => {
      throw new Error('store not ready')
    })
    mocks.listRunRecords.mockReturnValue([
      { id: 'r1', name: 'n', typeId: 'sdxl-lora', at: 1, config: { train_data_dir: 'D:/hist' } },
    ])
    expect(collectRecentDatasetPaths()).toEqual(['D:/hist'])
  })
})

// ─── 历史来源 ───────────────────────────────────────────────────────────────

describe('recentDatasetPaths: 从运行历史收集', () => {
  test('历史记录按 listRunRecords 的顺序追加在草稿之后', () => {
    mocks.getState.mockReturnValue({ typeId: 'sdxl-lora', drafts: { 'sdxl-lora': { train_data_dir: 'D:/draft' } } })
    mocks.listRunRecords.mockReturnValue([
      { id: 'r1', name: 'a', typeId: 'sdxl-lora', at: 2, config: { train_data_dir: 'D:/new' } },
      { id: 'r2', name: 'b', typeId: 'sdxl-lora', at: 1, config: { train_data_dir: 'D:/old' } },
    ])
    expect(collectRecentDatasetPaths()).toEqual(['D:/draft', 'D:/new', 'D:/old'])
  })

  test('config 缺失的记录被跳过而不是抛错', () => {
    mocks.getState.mockReturnValue({ typeId: 'sdxl-lora', drafts: {} })
    mocks.listRunRecords.mockReturnValue([
      { id: 'r1', name: 'a', typeId: 'sdxl-lora', at: 1, config: null },
      { id: 'r2', name: 'b', typeId: 'sdxl-lora', at: 2, config: { dataset_dir: 'D:/ok' } },
    ])
    expect(collectRecentDatasetPaths()).toEqual(['D:/ok'])
  })

  test('listRunRecords 抛错时草稿结果仍然返回', () => {
    mocks.getState.mockReturnValue({ typeId: 'sdxl-lora', drafts: { 'sdxl-lora': { train_data_dir: 'D:/draft' } } })
    mocks.listRunRecords.mockImplementation(() => {
      throw new Error('localStorage blocked')
    })
    expect(collectRecentDatasetPaths()).toEqual(['D:/draft'])
  })
})

// ─── 过滤与去重 ─────────────────────────────────────────────────────────────

describe('recentDatasetPaths: 占位与噪声过滤', () => {
  test('空串 / 空白 / 单字符 / nullish 都被丢掉', () => {
    withHistory([{ train_data_dir: '' }, { dataset_dir: '   ' }, { dataset_path: 'D' }, { train_data_path: null }])
    expect(collectRecentDatasetPaths()).toEqual([])
  })

  test('./ 与 . 这类占位被丢掉', () => {
    withHistory([{ train_data_dir: './' }, { dataset_dir: '.' }])
    expect(collectRecentDatasetPaths()).toEqual([])
  })

  test('含 sd-models 的路径一律丢掉（那是主模占位，不是数据集）', () => {
    withHistory([
      { train_data_dir: './sd-models' },
      { dataset_dir: 'D:/models/sd-models/foo' },
      { dataset_path: 'D:/data/real' },
    ])
    expect(collectRecentDatasetPaths()).toEqual(['D:/data/real'])
  })

  test('数值等非字符串值被字符串化后参与判定', () => {
    withHistory([{ train_data_dir: 12 }])
    expect(collectRecentDatasetPaths()).toEqual(['12'])
  })

  test('两字符路径保留（长度阈值是 < 2）', () => {
    withHistory([{ train_data_dir: 'D:' }])
    expect(collectRecentDatasetPaths()).toEqual(['D:'])
  })
})

describe('recentDatasetPaths: 去重口径', () => {
  test('尾部斜杠差异视为同一目录，保留首次出现的原始写法', () => {
    withHistory([{ train_data_dir: 'D:/data/x' }, { train_data_dir: 'D:/data/x/' }, { train_data_dir: 'D:/data/x\\\\' }])
    expect(collectRecentDatasetPaths()).toEqual(['D:/data/x'])
  })

  test('大小写差异视为同一目录（Windows 语义）', () => {
    withHistory([{ train_data_dir: 'D:/Data/X' }, { train_data_dir: 'd:/data/x' }])
    expect(collectRecentDatasetPaths()).toEqual(['D:/Data/X'])
  })

  test('草稿里出现过的路径不会被历史重复列出', () => {
    mocks.getState.mockReturnValue({ typeId: 'sdxl-lora', drafts: { 'sdxl-lora': { train_data_dir: 'D:/data/x' } } })
    mocks.listRunRecords.mockReturnValue([
      { id: 'r1', name: 'a', typeId: 'sdxl-lora', at: 1, config: { train_data_dir: 'D:/data/x/' } },
    ])
    expect(collectRecentDatasetPaths()).toEqual(['D:/data/x'])
  })

  test('反斜杠与正斜杠视为不同路径（不做分隔符归一）', () => {
    withHistory([{ train_data_dir: 'D:/data/x' }, { train_data_dir: 'D:\\data\\x' }])
    expect(collectRecentDatasetPaths()).toHaveLength(2)
  })
})

// ─── 上限 ───────────────────────────────────────────────────────────────────

describe('recentDatasetPaths: 数量上限', () => {
  test('默认封顶 12 条', () => {
    withHistory(Array.from({ length: 30 }, (_, i) => ({ train_data_dir: `D:/data/${i}` })))
    expect(collectRecentDatasetPaths()).toHaveLength(12)
  })

  test('显式 limit 生效，且在草稿阶段就会截断', () => {
    withDrafts('sdxl-lora', {
      'sdxl-lora': { train_data_dir: 'D:/a', dataset_dir: 'D:/b', dataset_path: 'D:/c' },
    })
    expect(collectRecentDatasetPaths(2)).toEqual(['D:/a', 'D:/b'])
  })

  test('limit 大于可用条数时原样返回', () => {
    withHistory([{ train_data_dir: 'D:/a' }])
    expect(collectRecentDatasetPaths(50)).toEqual(['D:/a'])
  })
})
