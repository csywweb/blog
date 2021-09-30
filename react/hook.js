
let value;
function useState(initValue) {
    value = value === undefined ? initValue : value;
    function dispatch(newValue) {
        value = newValue;
        scheduleWork();
    }

    return [value, dispatch];
}

function App() {
    const [count, setCount] = useState(0)
    return <div>
        {count}
        <button onClick={() => setCount(count + 1)}></button>
    </div>
}