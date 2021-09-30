let isMount = true;
let wipHook = null;

const fiber = {
    memoizedState: null,
    stateNode: App
};

function dispatchAction (queue, action) {
    const update = {
        action,
        next: null
    }

    if (queue.pending === null) {
        update.next = update;
    } else {
        update.next = queue.pending.next;
        queue.pending.next = update;
    }

    queue.pending = update;
    scheduleWork();
}

function useState2(initValue) {
    let hook = null;

    if (isMount) {
        hook = {
            queue: {
                pending: null
            },
            memoizedState: initValue,
            next: null
        }
        if (!fiber.memoizedState) {
            //  第一次
            fiber.memoizedState = hook;
        } else {
            wipHook.next = hook;
        }

        wipHook = hook;
    } else {
        hook = wipHook;
        wipHook = wipHook.next;
    }

    let baseState = hook.memoizedState;

    if (hook.queue.pending) {
        let firstUpdate = hook.queue.pending.next;
        do {
            const action = firstUpdate.action;
            baseState = action;
            firstUpdate = firstUpdate.next;
        } while(firstUpdate !== hook.queue.pending);

        hook.queue.pending = null;
    }

    hook.memoizedState = baseState;

    return [baseState, dispatchAction.bind(null, hook.queue)]
}

/* @jsx React.createElement */
function App() {
    let [count, setCount] = useState2(0);
    let [text, setText] = useState2('a');

    return <div>
        count: {count}
        <button onClick={() => {setCount(count+1);setCount(count+2)}}>click me</button>
        text: {text}
        <button onClick={() => {setText('b')}}>click me</button>
    </div>
}


function scheduleWork() {
    wipHook = fiber.memoizedState;
    ReactDOM.render(<App />, document.querySelector("#root"));
}

scheduleWork();
isMount = false;