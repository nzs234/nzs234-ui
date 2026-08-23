// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// ================================================================
// schemaIndex.js — 训练族 schema 汇总入口 + 公共 API
// 把各族(sdxl / anima / 长尾 / DiT 长尾 / 实验)的 section 汇成 SECTIONS_MAP,
// 并对外暴露 getSectionsForType / createDefaultConfig / buildRunConfig 等公共 API。
// 这是 main.js 与各 smoke/parity 工具的唯一公共入口(原先在 sdxlSchema 神文件尾部)。
// ================================================================
import { TRAINING_TYPES as ALL_TRAINING_TYPES, VISIBLE_TRAINING_TYPES, UI_TABS } from './trainingTypeRegistry.js';
import { TARGET_LORA_OPTIMIZERS, schedulerOptions } from './features/settingsOptions.js';
import { buildRunConfigFromSections } from './runConfigBuilder.js';
import {
  SDXL_LORA_SECTIONS, SDXL_ILECO_SECTIONS, SDXL_ADDIFT_SECTIONS, SDXL_MULTI_ADDIFT_SECTIONS,
  SDXL_FT_SECTIONS, SDXL_CN_SECTIONS, SDXL_TI_SECTIONS,
} from './sdxlSchema.js';
import {
  ANIMA_LORA_SECTIONS, ANIMA_EDIT_MODEL_SECTIONS, ANIMA_ILECO_SECTIONS, ANIMA_ADDIFT_SECTIONS,
  ANIMA_MULTI_ADDIFT_SECTIONS, ANIMA_FT_SECTIONS, ANIMA_CN_SECTIONS,
} from './animaSchema.js';
import {
  SD15_LORA_SECTIONS, SD15_ILECO_SECTIONS, SD15_ADDIFT_SECTIONS, SD15_MULTI_ADDIFT_SECTIONS,
  DB_SECTIONS, SD_CN_SECTIONS, SD_TI_SECTIONS, YOLO_SECTIONS, AESTHETIC_SCORER_SECTIONS,
} from './otherSchemas.js';
import {
  FLUX_LORA_SECTIONS, LUMINA_LORA_SECTIONS, QWEN_IMAGE_LORA_SECTIONS, HUNYUAN_DIT_LORA_SECTIONS,
  HUNYUAN_IMAGE_COMPAT_SECTIONS, FLUX_FT_SECTIONS, LUMINA_FT_SECTIONS, FLUX_CN_SECTIONS, NEWBIE_LORA_SECTIONS,
  KREA2_LORA_SECTIONS, KREA2_FT_SECTIONS, FLUX2_LORA_SECTIONS, ZIMAGE_LORA_SECTIONS, WAN22_TI2V_LORA_SECTIONS, WAN22_T2V_A14B_LORA_SECTIONS, BOOGU_LORA_SECTIONS, BOOGU_EDIT_LORA_SECTIONS, BOOGU_FT_SECTIONS, FLUX2_FT_SECTIONS, ZIMAGE_FT_SECTIONS, WAN22_FT_SECTIONS,
} from './otherDitSchemas.js';
import {
  LTX23_LORA_SECTIONS, LTX25_LORA_SECTIONS, LTX23_FT_SECTIONS, LTX25_FT_SECTIONS,
} from './ltx2Schemas.js';
import {
  LAB_DISTILLER_SECTIONS, SDXL_TURBO_LORA_SECTIONS, ANIMA_FEW_STEP_LORA_SECTIONS, NEWBIE_FEW_STEP_LORA_SECTIONS,
} from './experimentalTrainingSchemas.js';
import { CONCEPT_EDIT_UNIFIED_SECTIONS } from './conceptEditUnifiedSchema.js';
import { S_TRAINING_INTENT_PROFILE, S_DATASET_INTELLIGENCE, S_TURBOCORE } from './schemaFrontierGroups.js';
import {
  sec,
  applyAdapterFamilyCapabilities,
  getAdapterFamilyCapabilities,
  getBackendAdapterFamilyCapabilities,
} from './schemaCommon.js';
import { S_UNIVERSAL_DIT } from './universalDitFields.js';
import { MINIMAX_H3_LORA_SECTIONS, MINIMAX_H3_FT_SECTIONS } from './minimaxH3Schema.js';

export { ALL_TRAINING_TYPES, UI_TABS };
export { getAdapterFamilyCapabilities, getBackendAdapterFamilyCapabilities };
export const TRAINING_TYPES = VISIBLE_TRAINING_TYPES;

// TRAINING_TYPES 是侧栏可见列表；ALL_TRAINING_TYPES 用于导入/旧配置兼容校验。

// ================================================================
// SECTIONS_MAP
// ================================================================
const SECTIONS_MAP = {
  'sdxl-lora':              SDXL_LORA_SECTIONS,
  'sdxl-ileco':             SDXL_ILECO_SECTIONS,
  'sdxl-addift':            SDXL_ADDIFT_SECTIONS,
  'sdxl-multi-addift':      SDXL_MULTI_ADDIFT_SECTIONS,
  'sd-lora':                SD15_LORA_SECTIONS,
  'sd15-lora':              SD15_LORA_SECTIONS,
  'sd-ileco':               SD15_ILECO_SECTIONS,
  'sd-addift':              SD15_ADDIFT_SECTIONS,
  'sd-multi-addift':        SD15_MULTI_ADDIFT_SECTIONS,
  'flux-lora':              FLUX_LORA_SECTIONS,
  'lumina-lora':            LUMINA_LORA_SECTIONS,
  'qwen-image-lora':        QWEN_IMAGE_LORA_SECTIONS,
  'hunyuan-dit-lora':       HUNYUAN_DIT_LORA_SECTIONS,
  'hunyuan-image-lora':     HUNYUAN_IMAGE_COMPAT_SECTIONS,
  'anima-lora':             ANIMA_LORA_SECTIONS,
  'anima-edit-model':       ANIMA_EDIT_MODEL_SECTIONS,
  'anima-ileco':            ANIMA_ILECO_SECTIONS,
  'anima-addift':           ANIMA_ADDIFT_SECTIONS,
  'anima-multi-addift':     ANIMA_MULTI_ADDIFT_SECTIONS,
  'newbie-lora':            NEWBIE_LORA_SECTIONS,
  'krea2-lora':             KREA2_LORA_SECTIONS,
  'flux2-lora':             FLUX2_LORA_SECTIONS,
  'zimage-lora':            ZIMAGE_LORA_SECTIONS,
  'wan22-ti2v-lora':        WAN22_TI2V_LORA_SECTIONS,
  'wan22-t2v-a14b-lora':     WAN22_T2V_A14B_LORA_SECTIONS,
  'ltx23-lora':             LTX23_LORA_SECTIONS,
  'ltx25-lora':             LTX25_LORA_SECTIONS,
  'boogu-lora':             BOOGU_LORA_SECTIONS,
  'boogu-edit-lora': BOOGU_EDIT_LORA_SECTIONS,
  'lab-distiller':          LAB_DISTILLER_SECTIONS,
  'sdxl-turbo-lora':        SDXL_TURBO_LORA_SECTIONS,
  'anima-few-step-lora':    ANIMA_FEW_STEP_LORA_SECTIONS,
  'newbie-few-step-lora':   NEWBIE_FEW_STEP_LORA_SECTIONS,
  'concept-edit':           CONCEPT_EDIT_UNIFIED_SECTIONS,
  'sd-dreambooth':          DB_SECTIONS,
  'sdxl-finetune':          SDXL_FT_SECTIONS,
  'flux-finetune':          FLUX_FT_SECTIONS,
  'lumina-finetune':        LUMINA_FT_SECTIONS,
  'anima-finetune':         ANIMA_FT_SECTIONS,
  'krea2-finetune':         KREA2_FT_SECTIONS,
  'boogu-finetune':         BOOGU_FT_SECTIONS,
  'ltx23-finetune':         LTX23_FT_SECTIONS,
  'ltx25-finetune':         LTX25_FT_SECTIONS,
  'flux2-finetune':         FLUX2_FT_SECTIONS,
  'zimage-finetune':        ZIMAGE_FT_SECTIONS,
  'wan22-finetune':         WAN22_FT_SECTIONS,
  'minimax-h3-lora':        MINIMAX_H3_LORA_SECTIONS,
  'minimax-h3-finetune':    MINIMAX_H3_FT_SECTIONS,
  'sd-controlnet':          SD_CN_SECTIONS,
  'sdxl-controlnet':        SDXL_CN_SECTIONS,
  'anima-controlnet':       ANIMA_CN_SECTIONS,
  'flux-controlnet':        FLUX_CN_SECTIONS,
  'sd-textual-inversion':   SD_TI_SECTIONS,
  'sdxl-textual-inversion': SDXL_TI_SECTIONS,
  'yolo':                   YOLO_SECTIONS,
  'aesthetic-scorer':       AESTHETIC_SCORER_SECTIONS,
};

const TARGET_OPTIMIZER_TRAINING_TYPES = new Set(['sdxl-lora', 'anima-lora', 'anima-edit-model', 'newbie-lora']);
const TRAINING_INTENT_SUPPORTED_TYPES = new Set([
  'sdxl-lora',
  'sd-lora',
  'flux-lora',
  'lumina-lora',
  'qwen-image-lora',
  'hunyuan-dit-lora',
  'hunyuan-image-lora',
  'anima-lora',
  'anima-edit-model',
  'newbie-lora',
  'krea2-lora',
  'flux2-lora',
  'zimage-lora',
  'boogu-lora',
  'boogu-edit-lora',
  'sdxl-turbo-lora',
  'anima-few-step-lora',
  'newbie-few-step-lora',
]);
const UNIVERSAL_DIT_SECTION = {
  id: 'universal-dit-settings',
  tab: 'advanced',
  title: 'Universal DiT LoRA fallback',
  description: '对未被专用族路由识别的 DiT/Transformer 提供的探测与基础 LoRA 接入。',
  fields: S_UNIVERSAL_DIT,
};
const TRAINING_INTENT_PROFILE_SECTION = {
  id: 'training-intent-profile',
  tab: 'training',
  title: '训练用途建议',
  description: '用途 Profile 只生成配置建议，不会在运行时静默改写参数。',
  fields: S_TRAINING_INTENT_PROFILE,
};
const _profiledSectionsCache = {};
const REGISTERED_TRAINING_TYPE_IDS = new Set(ALL_TRAINING_TYPES.map((item) => item.id));

// dataset_intelligence_* 走的就是 sample_difficulty 那条权重 seam(后端
// trainer_execution_loop_config 在 dataset_intelligence_enabled 为真时直接把
// sample_difficulty_weighting 置成 provided 档),所以它的可见面必须与 weight-composer
// 完全一致。这里由 section 现场派生,而不是再维护第三份类型名单 —— 名单一多必漂移。
// 字段本身是数据集侧配置,挂进各族已有的 dataset-settings,不新开分组。
function withDatasetIntelligence(sections) {
  if (!sections.some((section) => section.id === 'weight-composer')) return sections;
  return sections.map((section) => (section.id === 'dataset-settings'
    ? { ...section, fields: [...section.fields, ...S_DATASET_INTELLIGENCE] }
    : section));
}

// TurboCore / Lulynx 优化开关的可见面。turbocore_* 与 lulynx_optimization_enabled 由
// UnifiedTrainingConfig(configs_performance.ConfigsPerformanceMixin) 承载,只有真正走
// entry_train + UnifiedTrainingConfig 的训练类型才读得到这些键。
//
// 下面这几族走的是别的进程边界,给它们挂开关只会渲染出一个提交后被丢弃的字段:
//   yolo / aesthetic-scorer  → entry_yolo.py / core.scorers,不构造 UnifiedTrainingConfig
//   lab-distiller / sdxl-turbo-lora / *-few-step-lora
//                            → core/runners/lab.py 的 LabSubprocessRunner 子进程工具
// 其余每个族都必须有这一段:原先只有 15 个族在自己的 schema 文件里手写了
// turbocore-settings,另外 23 个族(sd-*/flux/lumina/qwen/hunyuan/concept-edit 系列/
// anima-finetune/controlnet/TI/minimax-h3 等)在新 UI 里根本没有入口,导致后端支持
// 但 UI 无法开启。这里集中派生而不是往 23 个文件里各贴一遍,避免再次漂移。
const TURBOCORE_UNSUPPORTED_TYPES = new Set([
  'yolo',
  'aesthetic-scorer',
  'lab-distiller',
  'sdxl-turbo-lora',
  'anima-few-step-lora',
  'newbie-few-step-lora',
]);
const TURBOCORE_SECTION = sec(
  'turbocore-settings',
  'speed',
  'TurboCore 内核优化',
  'TurboCore 主开关 + Lulynx 优化,以及 CUDA/Triton 内核自动调优的高级参数。',
  [...S_TURBOCORE],
);

function withTurboCore(sections, typeId) {
  if (TURBOCORE_UNSUPPORTED_TYPES.has(typeId)) return sections;
  if (sections.some((section) => section.id === 'turbocore-settings')) {
    // 产品级开关属于标准配置路径；字段自己的 visibleWhen 负责隐藏危险参数。
    return sections.map((section) => (section.id === 'turbocore-settings'
      ? { ...section, expert: false }
      : section));
  }
  return [...sections, TURBOCORE_SECTION];
}

// 兼容旧名
export const SDXL_SECTIONS = SDXL_LORA_SECTIONS;

// ================================================================
// 公共 API
// ================================================================
// 显式暴露 schema 覆盖范围：注册表中的历史类型若没有专用 schema，不能静默套用 SDXL。
export function hasSchemaForType(typeId) {
  return Boolean(typeId && SECTIONS_MAP[typeId]);
}

export function getSectionsForType(typeId) {
  const resolvedTypeId = typeId || 'sdxl-lora';
  const source = SECTIONS_MAP[resolvedTypeId];
  if (!source) return [];
  if (!_profiledSectionsCache[resolvedTypeId]) {
    const base = withTurboCore(withDatasetIntelligence(source), resolvedTypeId);
    _profiledSectionsCache[resolvedTypeId] = TRAINING_INTENT_SUPPORTED_TYPES.has(resolvedTypeId)
      ? [TRAINING_INTENT_PROFILE_SECTION, UNIVERSAL_DIT_SECTION, ...base]
      : base;
  }
  return _profiledSectionsCache[resolvedTypeId];
}

function buildFieldMap(sections) {
  const map = new Map();
  for (const s of sections) for (const f of s.fields) map.set(f.key, f);
  return map;
}

const _fmCache = {};
function getFieldMapForType(typeId) {
  if (!_fmCache[typeId]) _fmCache[typeId] = buildFieldMap(getSectionsForType(typeId));
  return _fmCache[typeId];
}

export function getFieldDefinition(key, typeId) {
  if (typeId) return getFieldMapForType(typeId).get(key);
  // 走 getSectionsForType 而不是直接遍历 SECTIONS_MAP:后者是未经派生的原始表,
  // 查不到 withDatasetIntelligence 补进去的字段,无 typeId 时会假报"字段不存在"。
  for (const id of Object.keys(SECTIONS_MAP)) {
    const map = getFieldMapForType(id);
    if (map.has(key)) return map.get(key);
  }
  return undefined;
}

export function applyBackendConfigOptions(optionsPayload) {
  const payload = optionsPayload && typeof optionsPayload === 'object' ? optionsPayload : {};
  const optionValue = (option) => option && typeof option === 'object'
    ? String(option.value ?? '').trim()
    : String(option || '').trim();
  const uniqueOptions = (values) => {
    const seen = new Set();
    return (Array.isArray(values) ? values : [])
      .map((option) => {
        const value = optionValue(option);
        if (!value || seen.has(value)) return null;
        seen.add(value);
        return option && typeof option === 'object' ? { ...option, value } : value;
      })
      .filter(Boolean);
  };
  const optimizers = uniqueOptions(payload.optimizers || payload.optimizer_type);
  const schedulers = uniqueOptions(payload.schedulers || payload.lr_scheduler);
  const familyCapabilitiesChanged = applyAdapterFamilyCapabilities(payload);
  // frontier_optimizer_candidates 已于 2026-08-04 随门闸从后端下发中移除:
  // 它宣传过的每个候选现在都是 optimizers 里的普通条目,没有 opt-in flag。
  if (optimizers.length === 0 && schedulers.length === 0) return familyCapabilitiesChanged;
  const mergedOptimizerOptions = uniqueOptions([...optimizers, ...TARGET_LORA_OPTIMIZERS]);

  for (const [typeId, sections] of Object.entries(SECTIONS_MAP)) {
    for (const section of sections) {
      for (const field of section.fields || []) {
        if (field.key === 'optimizer_type' && optimizers.length > 0 && TARGET_OPTIMIZER_TRAINING_TYPES.has(typeId)) {
          field.options = mergedOptimizerOptions;
        } else if (field.key === 'lr_scheduler' && schedulers.length > 0) {
          field.options = schedulerOptions(schedulers);
        }
      }
    }
  }
  Object.keys(_fmCache).forEach((key) => delete _fmCache[key]);
  return true;
}

export function getSectionsForTab(tabKey, typeId) {
  const sections = getSectionsForType(typeId || 'sdxl-lora');
  let filtered = sections.filter((s) => {
    if (tabKey === 'dataset') return s.tab === 'dataset' || s.id === 'noise-settings';
    if (tabKey === 'advanced') return s.tab === 'advanced' && s.id !== 'noise-settings';
    if (tabKey === 'frontier') return s.tab === 'frontier';
    if (tabKey === 'model') return (s.tab === 'model' && s.id !== 'save-settings') || s.id === 'v-parameterization-settings' || s.id === 'rf-settings';
    if (tabKey === 'training') return (s.tab === 'training' || s.id === 'save-settings') && s.id !== 'v-parameterization-settings' && s.id !== 'rf-settings';
    return s.tab === tabKey;
  });

  if (tabKey === 'dataset') {
    const dataAugIndex = filtered.findIndex((s) => s.id === 'data-aug-settings');
    const noiseIndex = filtered.findIndex((s) => s.id === 'noise-settings');
    if (dataAugIndex !== -1 && noiseIndex !== -1 && noiseIndex !== dataAugIndex + 1) {
      const [noiseSection] = filtered.splice(noiseIndex, 1);
      filtered.splice(dataAugIndex + 1, 0, noiseSection);
    }
  }

  if (tabKey === 'training') {
    const trainingIndex = filtered.findIndex((s) => s.id === 'training-settings');
    const saveIndex = filtered.findIndex((s) => s.id === 'save-settings');
    if (trainingIndex !== -1 && saveIndex !== -1 && saveIndex !== trainingIndex + 1) {
      const [saveSection] = filtered.splice(saveIndex, 1);
      filtered.splice(trainingIndex + 1, 0, saveSection);
    }
  }

  if (tabKey === 'model') {
    const modelIndex = filtered.findIndex((s) => s.id === 'model-settings');
    const vParamIndex = filtered.findIndex((s) => s.id === 'v-parameterization-settings');
    const rfIndex = filtered.findIndex((s) => s.id === 'rf-settings');
    const moved = [];
    if (vParamIndex !== -1) {
      moved.push(filtered.splice(vParamIndex, 1)[0]);
    }
    const rfCurrentIndex = filtered.findIndex((s) => s.id === 'rf-settings');
    if (rfCurrentIndex !== -1) {
      moved.push(filtered.splice(rfCurrentIndex, 1)[0]);
    }
    if (modelIndex !== -1 && moved.length) {
      filtered.splice(modelIndex + 1, 0, ...moved);
    }
  }

  return filtered;
}

export function getAvailableTabs(typeId, config) {
  const sections = getSectionsForType(typeId || 'sdxl-lora');
  const tabSet = new Set();
  for (const s of sections) tabSet.add(s.tab);
  // expertMode = 顶栏「高级」= performance_expert_mode；标准模式隐藏 expertOnly 页签（高级/先锋）
  const expertMode = !!(config && config.performance_expert_mode);
  return UI_TABS.filter((t) => tabSet.has(t.key) && (!t.expertOnly || expertMode));
}

export function isFieldVisible(field, config) {
  if (field?.requiresAttentionBackend) {
    const backend = String(config?.attention_backend || config?.attn_mode || config?.anima_attn_mode || '').trim().toLowerCase();
    if (field.requiresAttentionBackend === 'flash2') {
      if (backend !== 'flash2') return false;
    } else if (backend !== field.requiresAttentionBackend) {
      return false;
    }
  }
  if (!field?.visibleWhen) return true;
  return field.visibleWhen(config);
}

export function createDefaultConfig(typeId) {
  const config = {};
  for (const s of getSectionsForType(typeId || 'sdxl-lora'))
    for (const f of s.fields)
      config[f.key] = Array.isArray(f.defaultValue) ? [...f.defaultValue] : (f.defaultValue ?? '');
  return config;
}

export function normalizeDraftValue(field, rawValue) {
  if (!field) return rawValue;
  if (field.type === 'ui_group') return '';
  if (field.key === 'prior_loss_weight' && (rawValue === '' || rawValue === null || rawValue === undefined)) return 1;
  if (field.type === 'boolean') return Boolean(rawValue);
  if (field.type === 'multiSelect') return Array.isArray(rawValue) ? [...rawValue] : [];
  if (field.type === 'number' || field.type === 'slider') {
    if (rawValue === '' || rawValue === null || rawValue === undefined) return '';
    const p = Number(rawValue);
    return Number.isNaN(p) ? '' : p;
  }
  return rawValue;
}

export function buildRunConfig(config, typeId) {
  return buildRunConfigFromSections(config, typeId, { getSectionsForType, isFieldVisible });
}
