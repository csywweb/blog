

/* @jsx React.createElement */
function Child() {
    const [count, setCount] = React.useState(1);
    const [text, setText] = React.useState('a');
    const onAdd = () => {
        debugger;
        console.log(123)
        let newcount = count + 1;
        setCount(count+1)
        setCount(count+2)
        setCount(count+3)
        // setText('b');
    }
    console.log("render")
    return <div>
        function count: {count}
        <button onClick={onAdd}>按钮</button>
    </div>
}

/* @jsx React.createElement */
class Foo extends React.Component {
    state = {
        count: 1
    }

    onAdd = () => {
        this.setState({
            count: this.state.count + 1
        })
        this.setState({
            count: this.state.count +2
        })
        this.setState({
            count: this.state.count +3
        })
    }
    render() {
        return <div>class count: {this.state.count} <button onClick={this.onAdd}>按钮</button>     </div>
    }
}

/* @jsx React.createElement */
function App(props) {
    return <div>
        <Child></Child>
        <Foo></Foo>
    </div>
}

ReactDOM.render(<Foo></Foo>, document.getElementById("root"))