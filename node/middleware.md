```
const middlewares = [];
const ctx = { /* 模拟获取context */ };

// 执行器入口
function composeMiddles() {
  let i = 0;
  async function composed(idx) {
    let middle = middlewares[idx];
    if (idx >= middlewares.length) {
      return Promise.resolve();
    }
    try {
      return await middle(ctx, composed.bind(null, idx + 1))
    } catch (error) {
      return promise.reject(error);
    }
  }
  return composed(i);
}

async function invoke() {
    await composeMiddles();
}
invoke();
```