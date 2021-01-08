// Animated 有两个有用的属性。
//  1. payload
//  2. children
export default abstract class Animated<Payload = unknown> {
  public abstract getValue(): any
  public getAnimatedValue() {
    return this.getValue()
  }

  protected payload?: Payload
  public getPayload() {
    return this.payload || this
  }

  public attach(): void {}

  public detach(): void {}

  private children: Animated[] = []

  public getChildren() {
    return this.children
  }

  public addChild(child: Animated) {
    if (this.children.length === 0) this.attach()
    this.children.push(child)
  }

  public removeChild(child: Animated) {
    const index = this.children.indexOf(child)
    this.children.splice(index, 1)
    if (this.children.length === 0) this.detach()
  }
}

// AnimatedArray 实现了 attach 和 detach
// 理解为：AnimatedArray 数组被 attach 时，会遍历他的 payload 数组
// 如果 payload 项是 Animated，则该项执行 addChild(this)，payload 也会执行 attach()
export abstract class AnimatedArray<Payload = unknown> extends Animated<
  Payload[]
> {
  protected payload = [] as Payload[]

  attach = () =>
    this.payload.forEach(p => p instanceof Animated && p.addChild(this))

  detach = () =>
    this.payload.forEach(p => p instanceof Animated && p.removeChild(this))
}

export abstract class AnimatedObject<
  Payload extends { [key: string]: unknown }
> extends Animated<Payload> {
  protected payload = {} as Payload

  /**
   * 它被 attach 时，会将其 payload 中的 Animated 执行 addChild()
   *
   * @param animated true 则取 payload 的 getAnimatedValue，并过滤掉非 Animated 的 payload
   *                 false 则取 payload 的 getValue 或者 payload 的 value
   */
  getValue(animated = false) {
    const payload: { [key: string]: any } = {}
    for (const key in this.payload) {
      const value = this.payload[key]
      if (animated && !(value instanceof Animated)) continue
      payload[key] =
        value instanceof Animated
          ? value[animated ? 'getAnimatedValue' : 'getValue']()
          : value
    }
    return payload
  }

  getAnimatedValue() {
    return this.getValue(true)
  }

  /**
   * s.addChild() 会触发 s.attach()
   * 所以 attach() 会递归往下执行，所以只需在最上层执行一次 attach。
   */
  attach = () =>
    Object.values(this.payload).forEach(
      s => s instanceof Animated && s.addChild(this)
    )

  detach = () =>
    Object.values(this.payload).forEach(
      s => s instanceof Animated && s.removeChild(this)
    )
}
