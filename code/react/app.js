var express = require('express')
var app = express()

app.get('/', function (req, res) {
    res.send('POST request to the homepage')
})
app.use(express.static('./'))
app.listen(3000, () => {
    console.log(`Example app listening at http://localhost:${3000}`)
})