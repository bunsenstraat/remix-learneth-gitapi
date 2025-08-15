var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");

var indexRouter = require("./routes/index");

var app = express();

// Enhanced logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n🔵 [${timestamp}] ${req.method} ${req.url}`);
  console.log(`📍 Origin: ${req.get('origin') || 'none'}`);
  console.log(`🌐 User-Agent: ${req.get('user-agent') || 'none'}`);
  console.log(`📝 Headers:`, JSON.stringify(req.headers, null, 2));
  
  if (Object.keys(req.query).length > 0) {
    console.log(`❓ Query params:`, req.query);
  }
  
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`📦 Body:`, req.body);
  }
  
  next();
});

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "jade");

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use("/", indexRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  console.log(`❌ 404 Not Found: ${req.method} ${req.url}`);
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  console.log(`💥 Error occurred:`, {
    message: err.message,
    status: err.status,
    stack: err.stack,
    url: req.url,
    method: req.method
  });
  
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render("error");
});

module.exports = app;
