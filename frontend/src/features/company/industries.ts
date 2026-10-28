export const industries = ['제조', '건설', '도소매', '부동산 임대'] as const
export type Industry = (typeof industries)[number]
