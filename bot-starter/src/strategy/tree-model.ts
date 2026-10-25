interface Node { v?: number; f?: number; t?: number; l?: Node; r?: Node; }
export interface Model { initial: number; rate: number; kind: string; trees: Node[]; }

export function predict(model: Model, x: number[]): number {
  let value = model.initial;
  for (let n of model.trees) {
    while (n.v === undefined) n = Math.fround(x[n.f!]!) <= n.t! ? n.l! : n.r!;
    value += model.rate * n.v!;
  }
  return model.kind === 'word' ? 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value)))) : model.kind === 'value' ? value : Math.expm1(value);
}
