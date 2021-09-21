// 手写react
let nextUnitOfWork = null;
let wipRoot = null;
let currentRoot = null;
let deletions = null
let wipFiber = null;
let hookIndex = null;
// create Element
function createElement(type, props, ...children) {
    return {
        type,
        props: {
            ...props,
            children: children.map(child => {
                if (typeof child !== 'object') {
                    return {
                        type: 'TEXT_ELEMENT',
                        props: {
                            children: [],
                            nodeValue: child
                        }
                    }
                } else {
                    return child;
                }
            })
        }
    }
}

function createDom(filber) {
    let dom = filber.type === 'TEXT_ELEMENT' ? document.createTextNode('') : document.createElement(filber.type);

    const isProperty = (el) => el !== 'children'
    Object.keys(filber.props)
        .filter(isProperty)
        .forEach(name => {
            dom[name] = filber.props[name];
        })

    return dom;
}
function commitRoot() {
    deletions.forEach(commitWork);
    commitWork(wipRoot.child);
    currentRoot = wipRoot;
    wipRoot = null;
}
const isEvent = key => key.startsWith("on")
const isProperty = key =>
    key !== "children" && !isEvent(key)
const isNew = (prev, next) => key =>
    prev[key] !== next[key]
const isGone = (prev, next) => key => !(key in next)
function updateDom(dom, prevProps, nextProps) {
    Object.keys(prevProps)
        .filter(isEvent)
        .filter(
            key =>
                !(key in nextProps) ||
                isNew(prevProps, nextProps)(key)
        )
        .forEach(name => {
            const eventType = name
                .toLowerCase()
                .substring(2)
            dom.removeEventListener(
                eventType,
                prevProps[name]
            )
        })
    // Remove old properties
    Object.keys(prevProps)
        .filter(isProperty)
        .filter(isGone(prevProps, nextProps))
        .forEach(name => {
            dom[name] = ""
        })

    // Set new or changed properties
    Object.keys(nextProps)
        .filter(isProperty)
        .filter(isNew(prevProps, nextProps))
        .forEach(name => {
            dom[name] = nextProps[name]
        })
    // Add event listeners
    Object.keys(nextProps)
        .filter(isEvent)
        .filter(isNew(prevProps, nextProps))
        .forEach(name => {
            const eventType = name
                .toLowerCase()
                .substring(2)
            dom.addEventListener(
                eventType,
                nextProps[name]
            )
        })
}

function commitDeletion(fiber, domParent) {
    if (fiber.dom) {
        domParent.removeChild(fiber.dom);
    } else {
        commitDeletion(fiber.child, domParent);
    }
}

function commitWork(fiber) {
    if (!fiber) return;
    // 类似二叉树遍历

    let domParentFiber = fiber.parent;
    while(!domParentFiber.dom) {
        domParentFiber = domParentFiber.parent;
    }
    const parent = domParentFiber.dom;
    console.log("fiber:", fiber);
    if (
        fiber.effectTag === "PLACEMENT" &&
        fiber.dom != null
    ) {
        parent.appendChild(fiber.dom)
    } else if (
        fiber.effectTag === "UPDATE" &&
        fiber.dom != null
    ) {
        updateDom(
            fiber.dom,
            fiber.alternate.props,
            fiber.props
        )
    } else if (fiber.effectTag === "DELETION") {
        commitDeletion(fiber, parent);
    }


    commitWork(fiber.child);
    commitWork(fiber.sibling);

}
function render(element, root) {
    console.log("render")
    wipRoot = {
        dom: root,
        props: {
            children: [element]
        },
        alternate: currentRoot
    }

    deletions = []
    nextUnitOfWork = wipRoot;
}

function useState(initial) {
    const oldHook = wipFiber.alternate && wipFiber.alternate.hooks && wipFiber.alternate.hooks[hookIndex]
    const hook = {
        state: oldHook ? oldHook.state : initial,
        queue: [],
    }

    const actions = oldHook ? oldHook.queue : []
    actions.forEach(action => {
        hook.state = action(hook.state)
    })
    const setState = action => {
        hook.queue.push(action);
        wipRoot = {
            dom: currentRoot.dom,
            props: currentRoot.props,
            alternate: currentRoot
        }
        nextUnitOfWork = wipRoot;
        deletions = [];
    }

    wipFiber.hooks.push(hook);
    hookIndex++;
    return [hook.state, setState]
}

function workloop(deadline) {
    let shouldYield = false;

    while (nextUnitOfWork && !shouldYield) {
        nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
        console.log("deadline.timeRemaining():", deadline.timeRemaining())
        shouldYield = deadline.timeRemaining() < 1; // 每一帧剩余时间。毫秒数
    }


    // filber生成完之后 commit
    if (!nextUnitOfWork && wipRoot) {
        commitRoot()
    }
    requestIdleCallback(workloop);
}

requestIdleCallback(workloop);

function reconcileChildren(wipFiber, elements) {
    let index = 0;
    let oldFiber = wipFiber.alternate && wipFiber.alternate.child
    let prevSibling = null; // 前置指针

    while (index < elements.length || oldFiber != null) {
        let ele = elements[index];
        let newFiber = {};
        const sameType =
            oldFiber &&
            ele &&
            ele.type == oldFiber.type

        if (sameType) {
            // TODO update the node
            newFiber = {
                type: oldFiber.type,
                dom: oldFiber.dom,
                parent: wipFiber,
                props: ele.props,
                alternate: oldFiber,
                effectTag: "UPDATE",
            }

        }
        if (ele && !sameType) {
            newFiber = {
                type: ele.type,
                props: ele.props,
                dom: null,
                parent: wipFiber,
                alternate: null,
                effectTag: "PLACEMENT",
            }
        }
        if (oldFiber && !sameType) {
            oldFiber.effectTag = "DELETION"
            deletions.push(oldFiber)
        }

        if (oldFiber) {
            oldFiber = oldFiber.sibling
        }

        if (index === 0) {
            wipFiber.child = newFiber
        } else if (ele) {
            prevSibling.sibling = newFiber
        }



        prevSibling = newFiber;
        index++;
    }
}

function updateHoseComponent(fiber) {
    if (!fiber.dom) {
        fiber.dom = createDom(fiber);
    }

    const elements = fiber.props.children;

    reconcileChildren(fiber, elements)
}

function updateFunctionComponent(fiber) {
    wipFiber = fiber;
    hookIndex = 0;
    wipFiber.hooks = [];
    const children = [fiber.type(fiber.props)];

    reconcileChildren(fiber, children);
}
function performUnitOfWork(filber) {
    const isFunctionComponent = filber.type && filber.type instanceof Function;

    if (isFunctionComponent) {
        updateFunctionComponent(filber);
    } else {
        updateHoseComponent(filber);
    }

    // return nextunitofwork
    // 如果有子 返回子，如果有兄弟返回兄弟

    if (filber.child) {
        return filber.child;
    }

    let nextFilber = filber;
    while (nextFilber) {
        if (nextFilber.sibling) {
            return nextFilber.sibling;
        }

        nextFilber = nextFilber.parent;
    }
}

const Fake = {
    createElement,
    render,
    useState,
}

/* @jsx Fake.createElement */
function App(props) {
    const [state, setState] = Fake.useState(1);
    return <div>
        <h1 onclick={() => setState(c => c+1)}>我是{props.name}</h1>
        <p>啊哈哈哈哈
            <span>{state}</span>
        </p>
    </div>
}

const element = (
    <div>
        <h1 >我是</h1>
        <p>啊哈哈哈哈
            <span>heiheihie</span>
        </p>
    </div>
)
Fake.render(<App name="标题"></App>, document.getElementById("root"))