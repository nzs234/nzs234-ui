// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// desc 文案表 —— F4 残量收口：i18nGapScan 报出的 missing desc_en 全量。
//
// 与其它 descContent 分表的分工：本表只负责「zh 已经写好、缺的是 en」的键，因此
// 每条的 zh 与 schema 源里的现文案逐字相同 —— applyDescContent 跑起来对这些键是
// no-op，syncDescEnPack 只取 en 落进 src/i18n/schemaFieldDescsEn.json。
//
// 隐藏字段（type:'hidden'）也在列：它们不渲染，但 i18nGapScan 的 desc_en 覆盖面按
// 字段键统计，且 EN 文案是这些内部键唯一的成文说明；applyDescContent 本来就跳过
// type:'hidden'，所以这里的 zh 只是给人看的注解，不会被写回 schema。
export default {
  // ── UI 分组占位（收起提示）──
  __ui_group_compile_expert_collapsed: ['高级 Compile 策略已收起', 'Advanced compile strategy controls are collapsed. Turn on performance expert mode to expose them.'],

  // ── 自适应训练控制 ──
  adaptive_training_enabled: ['关闭时保持经典固定训练，不创建控制器；开启后可选择建议或受约束自动调整。', 'Off keeps classic fixed-schedule training with no controller attached; on lets you pick advisory or constrained-automatic adjustment. Leave off unless you want the controller in the loop.'],
  adaptive_training_adjustments: ['建议模式也会记录建议；自动模式会先经过证据门槛、上下界和锁定项检查。', 'Which knobs the controller may touch. Advisory mode only records proposals; automatic mode still has to clear the evidence threshold, the configured bounds and the locked-item list. Start with learning rate alone.'],

  // ── Anima 忠实前向 / Newbie sigma / 预览求解器 ──
  anima_faithful_degrade_policy: ['请求了忠实前向、检查点带冻结 llm_adapter 但前置条件缺失（缓存缺 t5_input_ids / 开着不兼容 seam）时的行为：fail 拒绝启动（默认——legacy 条件空间没训练过该 checkpoint，跑完只会产出噪声图）；warn 提示后继续降级。建议保持 fail；确认想临时对比 legacy 路径时才选 warn。', 'What happens when faithful forward is requested against a checkpoint with a frozen llm_adapter but the prerequisites are missing (cache without t5_input_ids, or an incompatible seam left on): fail refuses to start (default, because the checkpoint was never trained in the legacy conditioning space and the run would only emit noise), warn degrades after a notice. Keep fail; pick warn only for a deliberate legacy-path comparison.'],
  newbie_sigma_schedule: ['Newbie 训练噪声 sigma 的分布预设：standard 是参考实现自己的默认 logit-normal(0,1)、无分辨率偏移；lulynx 在同一采样上叠加分辨率相关的 flow shift，把更多噪声预算放到高噪声区（分辨率越高 shift 越大），预览与训练走同一条变换。显式设置 ddpm_timestep_sampling 或开启 FasterDiT SNR 时以其为准。建议 standard 起步；出图整体偏灰/高噪细节不足时用 lulynx 做 A/B 对照。', 'Noise-sigma distribution preset for Newbie training. standard is the reference implementation default, plain logit-normal(0,1) with no resolution bias; lulynx layers a resolution-dependent flow shift on the same sampling so more of the noise budget lands in the high-noise region (larger shift at higher resolution), and preview follows the same transform as training. An explicit ddpm_timestep_sampling or FasterDiT SNR takes precedence. Start on standard; A/B against lulynx when output looks flat or lacks high-noise detail.'],
  sample_algorithm: ['训练中预览的求解算法：sde 走 ER-SDE-Solver-3 并带退火随机项（默认）；ode 为确定性 Euler 路径，无随机项。建议 sde（默认）；想排除随机性做逐步对照时切 ode 并把 SDE eta 设 0。', 'Solver used for in-training previews: sde runs ER-SDE-Solver-3 with an annealed stochastic term (default), ode follows a deterministic Euler path with no noise injection. Keep sde; switch to ode with SDE eta at 0 when you need step-by-step comparability.'],
  sample_sde_eta: ['缩放 sde 求解器的随机项强度：1.0 为后端默认；eta=0 时与 ode 路径完全一致（可做 A/B 对照）。推荐范围：0–1；>1 会明显放大预览噪声，仅实验用。', 'Scales the stochastic term of the sde solver; 1.0 is the backend default and eta=0 reproduces the ode path exactly, which makes A/B comparison easy. Recommended: 0-1; above 1 visibly amplifies preview noise and is experiment-only.'],

  // ── 轨迹蒸馏研究目标 ──
  trajectory_variant: ['两步轨迹研究目标的形状：two_step 一次跳跃+直通连接器拼接（2 次前向，默认）；sparse 沿模型自身轨迹走 K 个 detached Euler 点、无连接器（K 次前向+K 份激活），监督更密但不是省钱档。建议保持 two_step；想加稠密同轨迹监督时选 sparse 并把 sparse_steps 调到 4–8。', 'Shape of the two-step trajectory research objective: two_step stitches one jump with a straight-through connector (2 forward passes, default), while sparse walks K detached Euler points along the model own trajectory with no connector (K forward passes and K activation sets) for denser supervision at a real cost. Keep two_step; choose sparse with sparse_steps at 4-8 when you want dense on-trajectory supervision.'],
  trajectory_sparse_steps: ['trajectory_variant=sparse 时沿轨迹走的欧拉步点数 K（决定前向次数与显存占用）。推荐范围：4（默认）–8；下限 2。', 'Number of Euler points K walked along the trajectory when trajectory_variant is sparse, which sets both the forward-pass count and the activation footprint. Recommended: 4-8, floor 2.'],
  trajectory_mix_ratio: ['micro-batch 中走轨迹目标的比例，其余走标准蒸馏目标。0.0 是有意义设置（纯标准：轨迹通路仍被解析校验但不参与）；与「未设置」在后端 resolver 里是两回事，0 会原样透传。推荐范围：1.0（全量，默认）–0.5 对照实验。', 'Share of each micro-batch that uses the trajectory objective; the remainder falls back to the standard distillation objective. 0.0 is a meaningful setting (pure standard, where the trajectory path is still parsed and validated but contributes nothing) and is not the same as leaving the key unset, since 0 is forwarded verbatim to the backend resolver. Recommended: 1.0 for full coverage, 0.5 for controlled comparison.'],

  // ── Boogu ──
  boogu_load_mllm: ['默认关闭以复用文本缓存；仅在构建缓存或实时文本编码时开启，会显著增加内存/显存占用。', 'Off by default so cached text embeddings are reused; enable only while building the cache or when encoding captions live, since it adds a sizeable RAM and VRAM footprint.'],
  boogu_depth_expansion_enabled: ['交错复制 Boogu 单流 block，并以恒等残差初始化新增层。最终保存完整新底座。', 'Interleaves copies of Boogu single-stream blocks and initializes the inserted layers as identity residuals; the run saves a complete new base model. Full finetune only, and deliberate use only.'],
  boogu_depth_expansion_target_layers: ['扩层后的单流 Transformer block 总数（Base 原生 32）。', 'Total single-stream transformer blocks after expansion. Recommended: above the native 32 of the Base checkpoint; 40 is a moderate step.'],
  boogu_depth_expansion_train_scope: ['选择只训练新增层、同时训练外围模块，或训练全部参数。', 'Trains the inserted layers only, the inserted layers plus the input/time/output periphery, or every parameter. new_layers mirrors classic depth up-scaling and is the safe choice.'],

  // ── FLUX.2 ──
  flux2_block_residency: ['FLUX.2 Block 驻留', 'Residency policy for FLUX.2 transformer blocks: resident keeps them all on GPU, block_offload streams them adaptively. Keep block_offload unless VRAM is plentiful.'],
  flux2_block_offload_ratio: ['参与 block offload 的比例（0–100）。', 'Share of FLUX.2 blocks eligible for offload. Recommended: 100 to stream as much as possible, or 0 to disable; partial values rarely pay off.'],
  flux2_depth_expansion_enabled: ['交错复制 FLUX.2 单流 block（并行块，注意力/MLP 融合输出投影归零），以恒等残差初始化新增层。最终保存完整新底座。', 'Interleaves copies of FLUX.2 single-stream blocks (parallel blocks, with the fused attention/MLP output projection zeroed) so the inserted layers start as identity residuals; the run saves a complete new base model.'],
  flux2_depth_expansion_target_layers: ['扩层后的单流 Transformer block 总数（Klein-9B 原生 48；双流 8 层不参与扩层）。', 'Total single-stream transformer blocks after expansion; the 8 dual-stream blocks are untouched. Recommended: above the native 48 of Klein-9B, for example 60.'],
  flux2_depth_expansion_train_scope: ['选择只训练新增层、同时训练外围模块，或训练全部参数。', 'Trains the inserted layers only, the inserted layers plus the input/time/output periphery, or every parameter. new_layers is the conservative default.'],

  // ── Krea2 ──
  krea2_block_residency: ['Krea2 Block 驻留', 'Residency policy for Krea-2 blocks: resident keeps everything on GPU, block_offload streams whole blocks adaptively, layer_offload works at layer granularity for the tightest VRAM. Keep block_offload.'],
  krea2_block_offload_ratio: ['参与 block offload 的比例（0–100）。100 表示尽可能多 block 走 offload。', 'Share of Krea-2 blocks eligible for offload, where 100 streams as many blocks as possible. Recommended: 100 or 0; partial values rarely pay off.'],
  krea2_resident_block_count: ['始终留在 GPU 的 block 数；0=按策略自动。', 'Blocks pinned to GPU regardless of the offload policy. Recommended: keep 0 to let the policy decide, then raise a few blocks at a time if step time is transfer-bound.'],

  // ── Wan2.2 ──
  wan22_block_residency: ['Wan2.2 Block 驻留', 'Residency policy for Wan2.2 transformer blocks: resident keeps them on GPU, block_offload streams them adaptively. Keep block_offload for the larger towers.'],
  wan22_discrete_flow_shift: ['TI2V/I2V 倾向 5.0；T2V 常见 12.0。', 'Discrete-flow sampling shift for Wan2.2. Recommended: around 5.0 for TI2V/I2V and 12.0 for T2V, following the checkpoint family.'],
  wan22_depth_expansion_enabled: ['交错复制 Wan2.2 TI2V-5B block（自注意/交叉注意/FFN 三个输出投影归零），以恒等残差初始化新增层。仅支持 TI2V-5B 单塔；A14B 双塔不支持。最终保存完整新底座。', 'Interleaves copies of Wan2.2 TI2V-5B blocks (self-attention, cross-attention and FFN output projections zeroed) so the inserted layers start as identity residuals. Single-tower TI2V-5B only, the A14B dual tower is unsupported; the run saves a complete new base model.'],
  wan22_depth_expansion_target_layers: ['扩层后的 Transformer block 总数（TI2V-5B 原生 30）。', 'Total transformer blocks after expansion. Recommended: above the native 30 of TI2V-5B, for example 38.'],
  wan22_depth_expansion_train_scope: ['选择只训练新增层、同时训练外围模块，或训练全部参数。', 'Trains the inserted layers only, the inserted layers plus the input/time/output periphery, or every parameter. new_layers is the conservative default.'],

  // ── Z-Image ──
  zimage_block_residency: ['Z-Image Block 驻留', 'Residency policy for Z-Image blocks: resident keeps them on GPU, block_offload streams them adaptively. Keep block_offload on 6B bases.'],
  zimage_block_offload_ratio: ['参与 block offload 的比例（0–100）。', 'Share of Z-Image blocks eligible for offload. Recommended: 100 or 0; partial values rarely pay off.'],
  zimage_discrete_flow_shift: ['discrete flow shift，默认 2.0。', 'Discrete-flow sampling shift for Z-Image. Recommended: keep the 2.0 default unless the checkpoint documents otherwise.'],
  zimage_depth_expansion_enabled: ['交错复制 Z-Image 主干 layers block（attention 输出投影与 FFN w2 归零），以恒等残差初始化新增层。refiner 层不参与扩层。最终保存完整新底座。', 'Interleaves copies of Z-Image backbone layer blocks (attention output projection and FFN w2 zeroed) so the inserted layers start as identity residuals; refiner layers are excluded and the run saves a complete new base model.'],
  zimage_depth_expansion_target_layers: ['扩层后的主干 Transformer block 总数（Z-Image 6B 原生 30）。', 'Total backbone transformer blocks after expansion. Recommended: above the native 30 of Z-Image 6B, for example 38.'],
  zimage_depth_expansion_train_scope: ['选择只训练新增层、同时训练外围模块，或训练全部参数。', 'Trains the inserted layers only, the inserted layers plus the input/time/output periphery, or every parameter. new_layers is the conservative default.'],

  // ── 概念几何：Embedding / 翻译供给方 ──
  concept_geometry_embedding_model: ['如 BAAI/bge-m3', 'Text-embedding model id used to enrich concept geometry, for example BAAI/bge-m3. Applies when the provider downloads or resolves by id.'],
  concept_geometry_embedding_model_path: ['local_path 时使用', 'Local directory of the embedding model; used when the embedding provider is local_path.'],
  concept_geometry_embedding_api_base: ['provider=api 时的 endpoint。', 'Endpoint used when the embedding provider is api.'],
  concept_geometry_embedding_api_key: ['provider=api 时的密钥。', 'Credential for the embedding API. Prefer an environment variable or a local model over storing keys in a saved config.'],
  concept_geometry_embedding_api_model: ['远程 API 模型名', 'Model name requested from the remote embedding API.'],
  concept_geometry_translation_model_path: ['local_path 时使用', 'Local directory of the translation model; used when the translation provider is local_path.'],
  concept_geometry_translation_api_base: ['provider=api', 'Endpoint used when the translation provider is api.'],
  concept_geometry_translation_api_key: ['provider=api', 'Credential for the translation API. Prefer an environment variable or a local model over storing keys in a saved config.'],
  concept_geometry_translation_api_model: ['远程模型名', 'Model name requested from the remote translation API.'],
  concept_geometry_source_priority: ['逗号分隔：explicit,folder,nl,identity', 'Comma-separated order in which concept names are resolved (explicit, folder, nl, identity, tag, stem); the first source that yields a name wins. Keep the default unless your dataset labels concepts unusually.'],

  // ── EasyControl ──
  easy_control_enabled: ['旧版 EasyControl 入口。优先用 v2。', 'Legacy EasyControl entry point. Prefer the v2 controls; keep this off on new runs.'],
  easycontrol_v2_control_image_dir: ['控制图像根目录', 'Root directory holding the control images.'],
  easycontrol_v2_control_suffix: ['配对控制图文件后缀', 'Filename suffix that pairs a control image with its training image.'],

  // ── Anima Edit 数据契约 ──
  edit_source_prompt_field: ['可选。源图提示词字段名', 'Optional metadata field holding the source-image prompt. Leave the default unless your dataset uses another field name.'],
  edit_target_prompt_field: ['可选。目标图提示词字段名', 'Optional metadata field holding the target-image prompt. Leave the default unless your dataset uses another field name.'],
  edit_mask_field: ['可选。修改区域 mask 字段名。', 'Optional metadata field holding the edited-region mask. Leave the default unless your dataset uses another field name.'],
  edit_preserve_mask_field: ['可选。需要保持区域的 mask 字段名。', 'Optional metadata field holding the preserve-region mask. Leave the default unless your dataset uses another field name.'],
  edit_mask_weight: ['有 edit_mask 时用于提高或降低编辑区域 loss', 'Loss multiplier applied inside edit_mask when one is present. Recommended: keep 1.0 for neutral weighting and raise gently to push the edited region.'],
  edit_preserve_weight: ['有 preserve_mask 时额外约束保留区域。', 'Extra constraint on the preserve_mask region when one is present. Recommended: keep 0 unless the untouched area drifts.'],
  edit_timestep_schedule: ['控制参考注入在不同噪声阶段的强度。', 'Controls how strongly the reference latent is injected across noise stages: early_lock anchors composition early, mid_edit shifts influence to mid noise, mask_preserve favors the preserved region, off disables the schedule. Keep early_lock.'],

  // ── 概念编辑 / 目标提示词 ──
  target_prompt: ['目标概念提示词。iLECO 留空时偏向"擦除原概念"。', 'Prompt describing the target concept. Leaving it empty biases iLECO toward erasing the source concept instead of remapping it.'],

  // ── 分布式同步 ──
  gpu_ids: ['指定参与训练的 GPU 编号，多卡用逗号分隔（如 0,1）。', 'GPU indices taking part in the run, comma-separated (for example 0,1). Empty lets the launcher use every visible device.'],
  main_process_ip: ['主节点 IP 地址。多机训练时必填', 'Address of the rendezvous node. Required for multi-node runs and ignored on a single machine.'],
  sync_main_toml: ['主节点用于同步的 TOML 路径', 'Path to the TOML the main node publishes for workers to sync from.'],
  sync_config_keys_from_main: ['要从主节点同步的顶层配置键，逗号分隔。* = 同步全部', 'Top-level config keys pulled from the main node, comma-separated; * syncs everything. Narrow the list when workers need local overrides.'],
  sync_asset_keys: ['要从主节点补齐的资源键，逗号分隔', 'Asset path keys back-filled from the main node, comma-separated. The default covers base model, dataset, regularization, VAE and resume paths.'],
  sync_ssh_user: ['远程同步时使用的 SSH 用户名', 'SSH user used for remote sync.'],
  sync_ssh_password: ['远程同步密码。更推荐改用环境变量或共享路径', 'SSH password for remote sync. Prefer an environment variable, key-based auth or a shared path, since this value is stored with the config.'],

  // ── 杂项：单字段入口 ──
  hf_token_env: ['读取 HuggingFace Token 的环境变量名', 'Name of the environment variable holding the HuggingFace token; the token itself is never stored in the config.'],
  system_prompt: ['Lumina 系统提示词', 'System prompt prepended by the Lumina text encoder. Leave empty to use the model default.'],
  mem_eff_save: ['使用更省内存的保存方式', 'Streams checkpoints out with a lower peak RAM footprint at the cost of some save time. Enable when saving large finetunes on constrained hosts.'],
  ui_custom_params: ['危险：会直接覆盖界面中的参数', 'Danger: raw TOML merged last, overriding whatever the UI produced. Use only for keys the UI does not expose, and re-check preflight afterwards.'],
  route_status_note: ['Qwen Image 轻量入口，暂不能直接训练', 'Status note for this route: the Qwen Image entry is a lightweight selector only and its training core is not wired up yet.'],
  region_focus_enabled: ['在语义区域权重上叠加聚焦强度×步程衰减。开启时后端会强制启用语义区域加权。', 'Layers a focus strength and step-wise decay on top of semantic region weighting; enabling it forces semantic region weighting on in the backend. Try it when a local feature needs extra pull.'],
  rank_comp_target_suffixes: ['逗号分隔模块后缀；空=沿用该架构的量化目标表', 'Comma-separated module-name suffixes to compensate; empty follows the quantization target table of the architecture.'],
  timestep_weighting_lut_id: ['可选资产 id；path 优先。', 'Optional asset id for the timestep calibration table; an explicit path takes precedence.'],
  spd_scale_factors: ['逗号分隔缩放比例，例如 0.5,1.0。', 'Comma-separated resolution scale factors for progressive preview, for example 0.5,1.0.'],
  spd_steps_per_level: ['逗号分隔；留空时按预览总步数自动分配。', 'Comma-separated step counts per resolution level; empty splits the total preview steps automatically.'],
  sra2_haste_capture_layers: ['逗号分隔的 module-name 后缀。', 'Comma-separated module-name suffixes whose activations are captured.'],
  pixel_space_loss_weights: ['如 {"mse":1.0,"lpips":0.0}。', 'JSON weights for the pixel-space loss terms, for example {"mse":1.0,"lpips":0.0}. Raise lpips only when perceptual sharpness matters more than fidelity.'],
  multi_aspect_guidance_aspect_weights: ['例如 {"style":1.0,"character":1.5}。', 'JSON weights per guidance aspect, for example {"style":1.0,"character":1.5}. Empty weights every aspect equally.'],
  multi_aspect_guidance_custom_scorers: ['例如 {"style":"path/to', 'JSON map from aspect name to a custom scorer path. Empty uses the built-in scorers.'],
  class_names: ['类别名称，一行一个', 'Detection class names, one per line; the order defines the class indices written into the dataset.'],
  workers: ['数据加载 worker 数量', 'Data-loading worker processes. Recommended: 4-8 on a typical desktop; drop to 0 when debugging loader errors.'],

  // ── 隐藏字段（不渲染，仅登记内部键的英文说明）──
  ac_auto_lr_scale_factor: ['自动学习率调整的内部缩放因子（隐藏）。', 'Internal scale factor applied by the auto learning-rate adjuster; not user-facing.'],
  anima_guidance_scale: ['Anima 训练侧 guidance scale，固定透传（隐藏）。', 'Anima training-side guidance scale, forwarded as a fixed value; not user-facing.'],
  detected_vram_gb: ['探测到的显存容量（GB），由界面写入供档位推荐使用（隐藏）。', 'Detected VRAM capacity in GiB, written by the UI so profile recommendations can reason about the host; not user-facing.'],
  model_train_type: ['训练类型标识，随 schema 固定透传给后端（隐藏）。', 'Training-type identifier forwarded to the backend; fixed per schema and not user-facing.'],
  model_type: ['底模族标识，随 schema 固定透传（隐藏）。', 'Base-model family identifier forwarded to the backend; fixed per schema and not user-facing.'],
  model_family: ['少步蒸馏使用的模型族标识（隐藏）。', 'Model-family identifier used by the few-step distillation routes; not user-facing.'],
  schema_id: ['界面 schema 标识，用于旧配置回读匹配（隐藏）。', 'UI schema identifier used when matching restored legacy configs; not user-facing.'],
  training_type: ['训练形态标识（lora/finetune 等），随 schema 固定透传（隐藏）。', 'Training-form identifier (lora, finetune and so on) forwarded to the backend; fixed per schema and not user-facing.'],
  training_vram_profile_control: ['显存档位托管标记：managed 表示由档位接管（隐藏）。', 'Marks whether the VRAM profile manages the derived knobs; managed means the profile owns them. Not user-facing.'],
  model_prediction_type: ['模型预测类型', 'Prediction parameterization reported by the model (raw, additive or sigma_scaled). Fixed per family; not user-facing.'],
  weighting_scheme: ['损失加权策略', 'Loss weighting scheme over timesteps (logit_normal, mode, cosine, cosmap or none). Fixed per family; not user-facing.'],
  sigmoid_scale: ['sigmoid 缩放系数', 'Scale of the sigmoid timestep compression. Recommended: keep 1.0; only sigmoid-style samplers read it.'],
  sc_trigger_dropout: ['触发词随机 drop 概率（隐藏）。', 'Dropout probability for trigger tokens in the caption policy; not user-facing.'],
  sc_style_dropout: ['风格词随机 drop 概率（隐藏）。', 'Dropout probability for style tokens in the caption policy; not user-facing.'],
  sc_content_dropout: ['内容词随机 drop 概率（隐藏）。', 'Dropout probability for content tokens in the caption policy; not user-facing.'],
  sc_modifier_dropout: ['修饰词随机 drop 概率（隐藏）。', 'Dropout probability for modifier tokens in the caption policy; not user-facing.'],
  sc_locked_tags: ['永不参与 drop/shuffle 的标签列表（隐藏）。', 'Tags exempted from caption dropout and shuffling; not user-facing.'],
  edit_training_enabled: ['Edit 训练主开关，随类型固定为真（隐藏）。', 'Marks the run as edit training; fixed per type and not user-facing.'],
  edit_training_mode: ['Edit 训练形态（edit_lora 等），随类型固定（隐藏）。', 'Edit training mode (edit_lora and friends); fixed per type and not user-facing.'],
  edit_source_path_policy: ['源图路径解析策略，auto 由后端按数据集推断（隐藏）。', 'How source-image paths are resolved; auto lets the backend infer them from the dataset. Not user-facing.'],
  edit_target_path_policy: ['目标图路径解析策略，auto 由后端按数据集推断（隐藏）。', 'How target-image paths are resolved; auto lets the backend infer them from the dataset. Not user-facing.'],
  edit_mask_policy: ['mask 供给策略，optional 表示可缺省（隐藏）。', 'Whether masks are required; optional tolerates samples without one. Not user-facing.'],
};
