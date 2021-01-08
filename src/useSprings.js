import { useMemo, useRef, useImperativeHandle, useEffect } from 'react'
import Ctrl from './animated/Controller'
import { callProp, is } from './shared/helpers'

// ref 以 props 中第一个元素的 ref 为准。
// 如果 props 是函数，那么函数定义是 (i, controller) => ({ ... })，更新的时候函数定义也是这个
// 这个 Hook 没有一个 State... 所以产生动画时不会触发当前组件的更新

/** API
 * const props = useSprings(number, [{ ... }, { ... }, ...])
 * const [props, set] = useSprings(number, (i, controller) => ({ ... }))
 */

export const useSprings = (length, props) => {
  const mounted = useRef(false)
  const ctrl = useRef()
  const isFn = is.fun(props)

  // The controller maintains the animation values, starts and stops animations
  const [controllers, ref] = useMemo(() => {
    // Remove old controllers
    if (ctrl.current) {
      ctrl.current.map(c => c.destroy())
      ctrl.current = undefined
    }
    let ref
    return [
      new Array(length).fill().map((_, i) => {
        const ctrl = new Ctrl()
        const newProps = isFn ? callProp(props, i, ctrl) : props[i]
        if (i === 0) ref = newProps.ref
        ctrl.update(newProps)
        if (!ref) ctrl.start()
        return ctrl
      }),
      ref,
    ]
  }, [length])

  ctrl.current = controllers

  // The hooks reference api gets defined here ...
  const api = useImperativeHandle(ref, () => ({
    start: () =>
      Promise.all(ctrl.current.map(c => new Promise(r => c.start(r)))),
    stop: finished => ctrl.current.forEach(c => c.stop(finished)),
    get controllers() {
      return ctrl.current
    },
  }))

  // updateCtrl 的参数
  // 1. 如果是 isFn，这里的实参就应该是函数，其类型为：(i, controller) => ({ ... })
  // 2. 如果不是 isFn，则实参就是属性
  // This function updates the controllers
  const updateCtrl = useMemo(
    () => updateProps =>
      ctrl.current.map((c, i) => {
        c.update(isFn ? callProp(updateProps, i, c) : updateProps[i])
        if (!ref) c.start()
      }),
    [length]
  )

  // Update controller if props aren't functional
  useEffect(() => {
    if (mounted.current) {
      // 从第二次 render 才触发，第一次生成 controller 时已经触发 updateCtrl 了
      if (!isFn) updateCtrl(props)
      // 下面 c.start() 可以删掉
      // 因为第一次没有 ref 时，生成 controller 后已经执行 start 了
    } else if (!ref) ctrl.current.forEach(c => c.start())
  })

  // Update mounted flag and destroy controller on unmount
  useEffect(
    () => (
      (mounted.current = true), () => ctrl.current.forEach(c => c.destroy())
    ),
    []
  )

  // Return animated props, or, anim-props + the update-setter above
  // 返回值为 [当前值 AnimatedInterpolation, 更新 controller 函数, 暂停函数]
  const propValues = ctrl.current.map(c => c.getValues())
  return isFn
    ? [
        propValues,
        updateCtrl,
        finished => ctrl.current.forEach(c => c.pause(finished)),
      ]
    : propValues
}
