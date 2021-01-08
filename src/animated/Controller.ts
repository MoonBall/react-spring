import {
  callProp,
  interpolateTo,
  is,
  toArray,
  withDefault,
} from '../shared/helpers'
import AnimatedValue from './AnimatedValue'
import AnimatedValueArray from './AnimatedValueArray'
import { start, stop } from './FrameLoop'
import { colorNames, interpolation as interp, now } from './Globals'

type FinishedCallback = (finished?: boolean) => void

type AnimationsFor<P> = { [Key in keyof P]: any }

type ValuesFor<P> = { [Key in keyof P]: any }

type InterpolationsFor<P> = {
  [Key in keyof P]: P[Key] extends ArrayLike<any>
    ? AnimatedValueArray
    : AnimatedValue
}

let G = 0
/**
 * controller 用于生成动画值
 * 可以修改动画值（然后将值进行合并）、暂停/开启动画
 */
class Controller<P extends any = {}> {
  id: number

  idle = true
  hasChanged = false
  guid = 0
  local = 0
  props: P = {} as P
  merged: any = {}
  animations = {} as AnimationsFor<P>
  interpolations = {} as InterpolationsFor<P>
  values = {} as ValuesFor<P>
  configs: any = []

  // 在 start() 时添加新的回调
  // 在 stop() 是执行回调并清空
  // 初始的回调的目的是：
  //    在 queue 中任务执行完时，重置 this.idle 并执行 this.props.onRest()
  listeners: FinishedCallback[] = []

  // { to, ...config } 这里的 to 的类型为：arr/fn/object
  queue: any[] = []
  localQueue?: any[]

  constructor() {
    this.id = G++
  }

  /** update(props)
   *  This function filters input props and creates an array of tasks which are executed in .start()
   *  Each task is allowed to carry a delay, which means it can execute asnychroneously */
  update(args?: P) {
    //this._id = n + this.id

    if (!args) return this
    // Extract delay and the to-prop from props
    const { delay = 0, to, ...props } = interpolateTo(args) as any
    if (is.arr(to) || is.fun(to)) {
      // If config is either a function or an array queue it up as is
      this.queue.push({ ...props, delay, to })
    } else if (to) {
      // Otherwise go through each key since it could be delayed individually
      let ops: any = {}
      Object.entries(to).forEach(([k, v]) => {
        // Fetch delay and create an entry, consisting of the to-props, the delay, and basic props
        // 将其和上面的异步保持一致
        const entry = { to: { [k]: v }, delay: callProp(delay, k), ...props }
        const previous = ops[entry.delay] && ops[entry.delay].to
        ops[entry.delay] = {
          ...ops[entry.delay],
          ...entry,
          to: { ...previous, ...entry.to },
        }
      })
      this.queue = Object.values(ops)
    }
    // Sort queue, so that async calls go last
    this.queue = this.queue.sort((a, b) => a.delay - b.delay)

    // Diff the reduced props immediately (they'll contain the from-prop and some config)
    this.diff(props)
    return this
  }

  /**
   * 执行了 this.update() 后，会将后续的目标值放到 queue 中，如果不执行 start()，这些 queue 中的值不会生效
   */
  /** start(onEnd)
   *  This function either executes a queue, if present, or starts the frameloop, which animates */
  start(onEnd?: FinishedCallback) {
    // If a queue is present we must excecute it
    if (this.queue.length) {
      this.idle = false

      // this.localQueue 没有清空过。
      // 如果上一次的 queue 执行完了，那么这里多执行一次 merge 没问题
      // 如果上次 queue 没执行完，那么直接将前面 queue 的值都合并掉
      // { ...form1, ...form0, ...this.merged, ...to0, ...to1 } 挺奇怪的。不重要吧
      // 这里也没有处理 to 是数组和函数的情形
      // Updates can interrupt trailing queues, in that case we just merge values
      if (this.localQueue) {
        this.localQueue.forEach(({ from = {}, to = {} }) => {
          if (is.obj(from)) this.merged = { ...from, ...this.merged }
          if (is.obj(to)) this.merged = { ...this.merged, ...to }
        })
      }

      // The guid helps us tracking frames, a new queue over an old one means an override
      // We discard async calls in that caseÍ
      const local = (this.local = ++this.guid)
      const queue = (this.localQueue = this.queue)
      this.queue = []

      // Go through each entry and execute it
      queue.forEach(({ delay, ...props }, index) => {
        const cb: FinishedCallback = finished => {
          if (index === queue.length - 1 && local === this.guid && finished) {
            this.idle = true
            if (this.props.onRest) this.props.onRest(this.merged)
          }
          if (onEnd) onEnd()
        }

        // Entries can be delayed, ansyc or immediate
        let async = is.arr(props.to) || is.fun(props.to)
        if (delay) {
          setTimeout(() => {
            // 最后一次执行 start() 进来的，才能继续执行回调
            // 如果 setTimeout 后又启动了一次 start，那么不会继续执行
            if (local === this.guid) {
              if (async) this.runAsync(props, cb)
              else this.diff(props).start(cb)
            }
          }, delay)
        } else if (async) this.runAsync(props, cb)
        else this.diff(props).start(cb)
      })
    }
    // Otherwise we kick of the frameloop
    else {
      if (is.fun(onEnd)) this.listeners.push(onEnd)
      // onStart 会被执行多次，因为可能多次调用 start()
      if (this.props.onStart) this.props.onStart()
      start(this)
    }
    return this
  }

  stop(finished?: boolean) {
    this.listeners.forEach(onEnd => onEnd(finished))
    this.listeners = []
    return this
  }

  /** Pause sets onEnd listeners free, but also removes the controller from the frameloop */
  pause(finished?: boolean) {
    this.stop(true)
    if (finished) stop(this)
    return this
  }

  runAsync({ delay, ...props }: P, onEnd: FinishedCallback) {
    const local = this.local
    // If "to" is either a function or an array it will be processed async, therefor "to" should be empty right now
    // If the view relies on certain values "from" has to be present

    // 生成的新 props 不支持数组和函数，也不支持 delay
    // 所以下面是直接进行 diff().start() 而不是 update().start()
    let queue = Promise.resolve(undefined)
    if (is.arr(props.to)) {
      for (let i = 0; i < props.to.length; i++) {
        const index = i
        const fresh = { ...props, ...interpolateTo(props.to[index]) }
        if (is.arr(fresh.config)) fresh.config = fresh.config[index]
        queue = queue.then(
          (): Promise<any> | void => {
            //this.stop()
            if (local === this.guid)
              return new Promise(r => this.diff(fresh).start(r))
          }
        )
      }
    } else if (is.fun(props.to)) {
      let index = 0
      let last: Promise<any>
      // 这里的 to 的调用方式是这样的
      // const props = useSpring({
      //   to: async (next, cancel) => {
      //     await next({opacity: 1, color: '#ffaaee'})
      //     await next({opacity: 0, color: 'rgb(14,26,19)'})
      //   },
      //   from: {opacity: 0, color: 'red'}
      // })
      queue = queue.then(() =>
        props
          .to(
            // next(props)
            (p: P) => {
              const fresh = { ...props, ...interpolateTo(p) }
              if (is.arr(fresh.config)) fresh.config = fresh.config[index]
              //this.stop()
              if (local === this.guid)
                return (last = new Promise(r => this.diff(fresh).start(r)))
              return
            },
            // cancel()
            (finished = true) => this.stop(finished)
          )
          .then(() => last)
      )
    }
    queue.then(onEnd)
  }

  diff(props: any) {
    this.props = { ...this.props, ...props }
    let {
      from = {},
      to = {},
      config = {},
      reverse,
      attach,
      reset,
      immediate,
    } = this.props

    // Reverse values when requested
    if (reverse) {
      ;[from, to] = [to, from]
    }

    // This will collect all props that were ever set, reset merged props when necessary
    this.merged = { ...from, ...this.merged, ...to }

    this.hasChanged = false

    // target 是一个 Controller，在 useTrail 中是上一个 Controller
    // Attachment handling, trailed springs can "attach" themselves to a previous spring
    let target = attach && attach(this)
    // Reduces input { name: value } pairs into animated values
    this.animations = Object.entries<any>(this.merged).reduce(
      (acc, [name, value]) => {
        // 这里的关键是看 interpolation 是如何计算的
        // 注意：controller 是由 useSprings 生成的，而不是由 animatedComponent 生成的

        // Issue cached entries, except on reset
        let entry = acc[name] || {}

        // Figure out what the value is supposed to be
        const isNumber = is.num(value)
        const isString =
          is.str(value) &&
          !value.startsWith('#') &&
          !/\d/.test(value) &&
          !colorNames[value]
        const isArray = is.arr(value)
        const isInterpolation = !isNumber && !isArray && !isString

        // perspective(600px) rotateX(0deg) 是 isInterpolation
        // 因为 /\d/.test(value) 是 true

        let fromValue = !is.und(from[name]) ? from[name] : value
        let toValue = isNumber || isArray ? value : isString ? value : 1
        let toConfig = callProp(config, name)

        // target.animations[name].parent 是一个 AnimatedValue
        // 后面 toValues 会用到 toValue.getPayload()
        if (target) toValue = target.animations[name].parent

        let parent = entry.parent,
          interpolation = entry.interpolation,
          toValues = toArray(target ? toValue.getPayload() : toValue),
          animatedValues

        let newValue = value
        if (isInterpolation)
          // 这里是创建了 interpolate，然后用 1 去调用
          // 主要是标准化颜色
          newValue = interp({
            range: [0, 1],
            output: [value as string, value as string],
          })(1)
        let currentValue = interpolation && interpolation.getValue()

        // Change detection flags
        const isFirst = is.und(parent)
        // 不是第一个且动画还没有结束
        const isActive =
          !isFirst && entry.animatedValues.some((v: AnimatedValue) => !v.done)

        const currentValueDiffersFromGoal = !is.equ(newValue, currentValue)
        const hasNewGoal = !is.equ(newValue, entry.previous)
        const hasNewConfig = !is.equ(toConfig, entry.config)

        // TODO: Config 改变也会触发新的动画，config 改变时可能是 update() 触发的
        // 而不是 start() 触发的
        // Change animation props when props indicate a new goal (new value differs from previous one)
        // and current values differ from it. Config changes trigger a new update as well (though probably shouldn't?)
        if (
          reset ||
          (hasNewGoal && currentValueDiffersFromGoal) ||
          hasNewConfig
        ) {
          // Convert regular values into animated values, ALWAYS re-use if possible
          if (isNumber || isString)
            parent = interpolation =
              entry.parent || new AnimatedValue(fromValue)
          else if (isArray)
            parent = interpolation =
              entry.parent || new AnimatedValueArray(fromValue)
          else if (isInterpolation) {
            // prev 可以是 parent 的当前值
            // entry.interpolation.calc(entry.parent.value) 和 entry.interpolation.getValue() 是一样的
            let prev =
              entry.interpolation &&
              entry.interpolation.calc(entry.parent.value)
            prev = prev !== void 0 && !reset ? prev : fromValue
            if (entry.parent) {
              parent = entry.parent
              parent.setValue(0, false)
            } else parent = new AnimatedValue(0)
            const range = { output: [prev, value] }
            if (entry.interpolation) {
              interpolation = entry.interpolation
              entry.interpolation.updateConfig(range)
            } else interpolation = parent.interpolate(range)
          }

          toValues = toArray(target ? toValue.getPayload() : toValue)
          animatedValues = toArray(parent.getPayload())
          if (reset && !isInterpolation) parent.setValue(fromValue, false)

          this.hasChanged = true
          // Reset animated values
          animatedValues.forEach(value => {
            value.startPosition = value.value
            value.lastPosition = value.value
            // 这两步是在当前帧时，不会执行动画
            // 而是在下一帧开始执行动画
            value.lastVelocity = isActive ? value.lastVelocity : undefined
            value.lastTime = isActive ? value.lastTime : undefined
            value.startTime = now()
            value.done = false
            value.animatedStyles.clear()
          })

          // Set immediate values
          if (callProp(immediate, name)) {
            parent.setValue(isInterpolation ? toValue : value, false)
          }

          return {
            ...acc,
            [name]: {
              ...entry,
              name,

              // parent 就是当前动画的 AnimatedValue
              parent,
              // 当 isInterpolation 为 true 时，interpolation 是由 parent 进行插值进行计算的
              // 否则 interpolation 就是 parent
              interpolation,

              // 动画
              animatedValues,

              // 当 useTrail 时，toValues 值为 AnimatedValue[]
              // 在 FrameLoop 中会根据该值进行一些列逻辑
              toValues,
              // 目标值
              previous: newValue,
              config: toConfig,

              // from 传过去，和 to 结合判断方向。
              // 非 Spring 动画也需要该值
              fromValues: toArray(parent.getValue()),
              immediate: callProp(immediate, name),
              initialVelocity: withDefault(toConfig.velocity, 0),
              clamp: withDefault(toConfig.clamp, false),
              precision: withDefault(toConfig.precision, 0.01),
              tension: withDefault(toConfig.tension, 170),
              friction: withDefault(toConfig.friction, 26),
              mass: withDefault(toConfig.mass, 1),
              duration: toConfig.duration,
              easing: withDefault(toConfig.easing, (t: number) => t),
              decay: toConfig.decay,
            },
          }
        } else {
          if (!currentValueDiffersFromGoal) {
            // So ... the current target value (newValue) appears to be different from the previous value,
            // which normally constitutes an update, but the actual value (currentValue) matches the target!
            // In order to resolve this without causing an animation update we silently flag the animation as done,
            // which it technically is. Interpolations also needs a config update with their target set to 1.
            if (isInterpolation) {
              parent.setValue(1, false)
              interpolation.updateConfig({ output: [newValue, newValue] })
            }

            parent.done = true
            this.hasChanged = true
            return { ...acc, [name]: { ...acc[name], previous: newValue } }
          }
          return acc
        }
      },
      this.animations
    )

    if (this.hasChanged) {
      // Make animations available to frameloop
      this.configs = Object.values(this.animations)
      this.values = {} as ValuesFor<P>
      this.interpolations = {} as InterpolationsFor<P>
      for (let key in this.animations) {
        this.interpolations[key] = this.animations[key].interpolation
        this.values[key] = this.animations[key].interpolation.getValue()
      }
    }
    return this
  }

  destroy() {
    this.stop()
    this.props = {} as P
    this.merged = {}
    this.animations = {} as AnimationsFor<P>
    this.interpolations = {} as InterpolationsFor<P>
    this.values = {} as ValuesFor<P>
    this.configs = []
    this.local = 0
  }

  getValues = () => this.interpolations
}

export default Controller
