/**
 * 交付过程展示页静态配置（REQ-007）。
 *
 * 本文件是展示页节点与产物链接的**唯一回填点**：
 * - 仅列出本次需求的流程节点，不扩大展示范围（REQ-007.2 / REQ-007.6）；
 * - `status: 'pending'` 的节点只展示“未产出/进行中”，不渲染可点击链接（REQ-007.3）；
 * - 产物 `url` 为 `null` 时表示暂无外部可分享链接：渲染为不可点击的产物名，不产生失效链接；
 * - 后续节点（联调部署 / 发布部署验证）产出后，仅更新对应条目的 `status` 与 `url`。
 */

export type DeliveryStatus = 'done' | 'pending'

export interface DeliveryArtifact {
  /** 产物展示名的 i18n key：showcase.artifact.<key>。 */
  key: string
  /** 产物外部链接；null = 暂无可分享链接。 */
  url: string | null
}

export interface DeliveryNode {
  /** 节点标识；文案 key 为 showcase.node.<id>.title / .desc。 */
  id: string
  status: DeliveryStatus
  artifacts: DeliveryArtifact[]
}

export interface DeliveryShowcaseConfig {
  requirementId: string
  nodes: DeliveryNode[]
}

export const deliveryShowcase: DeliveryShowcaseConfig = {
  requirementId: 'spec-demo-space-collab-ordering',
  nodes: [
    {
      id: 'clarify',
      status: 'done',
      artifacts: [{ key: 'clarification', url: null }],
    },
    {
      id: 'product_spec',
      status: 'done',
      artifacts: [{ key: 'product_spec', url: null }],
    },
    {
      id: 'tech_spec',
      status: 'done',
      artifacts: [
        { key: 'tech_spec', url: null },
        { key: 'task_breakdown', url: null },
      ],
    },
    {
      id: 'automation',
      status: 'pending',
      artifacts: [{ key: 'e2e_cases', url: null }],
    },
    {
      id: 'testing',
      status: 'pending',
      artifacts: [{ key: 'test_report', url: null }],
    },
    {
      id: 'review',
      status: 'pending',
      artifacts: [{ key: 'merge_request', url: null }],
    },
    {
      id: 'release',
      status: 'pending',
      artifacts: [{ key: 'release_verification', url: null }],
    },
  ],
}

/** 读取展示页配置；读取异常时抛出，由页面展示失败提示与重试入口（REQ-007.5）。 */
export function loadDeliveryShowcase(): DeliveryShowcaseConfig {
  return deliveryShowcase
}
