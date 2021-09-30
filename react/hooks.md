# hook 的实现

和class组件不同，class组件的state是保存在class内部的，function组件把state保存在fiber节点的memoizedState

数据格式 {
    memoizedState: null,
    baseState: null, 
    baseQueue: null,//未处理的更新
    queue: null, // 环形链表
    next: null,
}

queue {
    pending: null,
    dispatch: null,
    lastRenderedReducer: reducer,
    lastRenderedState: initialState
}

每次setState在queue的队列里塞一个，然后触发render