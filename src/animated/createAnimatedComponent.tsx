import React, {
  forwardRef,
  MutableRefObject,
  ReactType,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import { handleRef, useForceUpdate, is } from '../shared/helpers'
import {
  AnimatedComponentProps,
  CreateAnimatedComponent,
} from '../types/animated'
import AnimatedProps from './AnimatedProps'
import { animatedApi, applyAnimatedValues } from './Globals'

const isFunctionComponent = (val: unknown): boolean =>
  is.fun(val) && !(val.prototype instanceof React.Component)

const createAnimatedComponent: CreateAnimatedComponent = <C extends ReactType>(
  Component: C
) => {
  const AnimatedComponent = forwardRef<C, AnimatedComponentProps<C>>(
    (props, ref) => {
      const forceUpdate = useForceUpdate()
      const mounted = useRef(true)
      const propsAnimated: MutableRefObject<AnimatedProps | null> = useRef(null)

      // 持有 Component 的 instance
      const node: MutableRefObject<C | null> = useRef(null)
      const attachProps = useCallback(props => {
        const oldPropsAnimated = propsAnimated.current
        const callback = () => {
          let didUpdate: false | undefined = false
          if (node.current) {
            didUpdate = applyAnimatedValues.fn(
              node.current,
              propsAnimated.current!.getAnimatedValue()
            )
          }
          if (!node.current || didUpdate === false) {
            // If no referenced node has been found, or the update target didn't have a
            // native-responder, then forceUpdate the animation ...
            forceUpdate()
          }
        }
        propsAnimated.current = new AnimatedProps(props, callback)
        oldPropsAnimated && oldPropsAnimated.detach()
      }, [])

      useEffect(
        () => () => {
          mounted.current = false
          // 组件卸载时，执行 detach() 方法
          propsAnimated.current && propsAnimated.current.detach()
        },
        []
      )

      // web 上是直接返回的 Component 对应的 instance
      useImperativeHandle<C, any>(ref, () =>
        animatedApi(node as MutableRefObject<C>, mounted, forceUpdate)
      )
      attachProps(props)

      const {
        scrollTop,
        scrollLeft,
        ...animatedProps
      } = propsAnimated.current!.getValue()

      // Functions cannot have refs, see:
      // See: https://github.com/react-spring/react-spring/issues/569
      // 这里没有判断 Component 是否是一个 ForwardRef 的函数组件，因为 React 没有暴露如何判断它
      const refFn = isFunctionComponent(Component)
        ? undefined
        : (childRef: C) => (node.current = handleRef(childRef, ref))
      return <Component {...animatedProps as typeof props} ref={refFn} />
    }
  )
  return AnimatedComponent
}

export default createAnimatedComponent
