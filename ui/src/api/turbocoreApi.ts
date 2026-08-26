// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { request } from './transport'

/** GET /api/turbocore/status 的 data 形状（resources/web/routers/turbocore.py）。 */
export interface TurboCoreStatusPayload {
  enabled?: boolean
}

/**
 * 全局 TurboCore 开关只读查询。
 *
 * 这是 trainer 后端 web 层唯一的 turbocore 状态 HTTP 端点（与 entry_train 消费的
 * backend/.turbocore_state.json 同一文件）。后端未升级时该端点可能 404/断连——
 * 调用方必须按「状态未知」处理，不得当作关闭。
 */
export const turbocoreApi = {
  status: () => request<TurboCoreStatusPayload>('/api/turbocore/status'),
}
