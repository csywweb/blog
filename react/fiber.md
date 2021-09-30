# 什么是fiber架构

fiber架构主要是为了解决，15版本中Reconciler之行时间过长，占用浏览器渲染进程主线程过久，导致页面卡顿的问题。
在16架构中将递归的无法中断的更新重构为异步的可中断更新。

主要是新增了一个scheduler，来作为任务的调度器，在处理每一个任务的时候，判断是否有足够的时间。


## render 阶段
render阶段分为‘递’阶段和‘归’阶段。
‘递’阶段调用beginwork方法，改方法会根据传入的fiber节点，创建子节点，直到没有子节点。

### begin work
begin work 会根据 current 来判断是否是update阶段。
update阶段，会根据props和type来判断能否复用，克隆current.fiber 到 wip.fiber
mounted阶段，会根据fiber.tag的类型来创建对应的fiber节点。
并通过协调器reconcile 生成effecttag 'UPDATE' | 'PLACEMENT'

生成effectList： 在rootfiber上有一个属性 finishedWork的列表，nexteffect指向下一个有effecttag的fiber节点

### complete work

处理元素的props。事件等一些属性
如果是mounted，则会给fiber节点创建dom


## commit 阶段
### before mutation阶段
重置一些变量
便利effectlist，依次执行commitBeforeMutationEffects
1. 处理DOM节点渲染/删除后的 autoFocus、blur逻辑
2. 调用getSnapshotBeforeUpdate钩子
3. 调度useEffect 钩子，注册回调函数。在scheduleCallback中调度flushPassiveEffects。layout之后effectlist复制给rootWithPendingPassiveEffects，flushPassiveEffects便利rootWithPendingPassiveEffects
### mutation

mutation阶段会遍历effectList，依次执行commitMutationEffects。
根据ContentReset effectTag重置文字节点，更新ref
该方法的主要工作为“根据effectTag调用不同的处理函数处理Fiber。例如插入，删除，更新
upload effect 会执行useLayoutEffect hook的回调函数

### layout
layout阶段会遍历effectList，依次执行commitLayoutEffects。
- commitLifeCycles，事件回调，useLayoutEffect，HostRoot如果有第三个参数，也会在这个时候调用。class组件会根据时更新还是初次渲染，触发didupdate和didmount

- commitAttachRef 更新ref

- 切换工作树