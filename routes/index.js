var express = require("express");
const shell = require("shelljs");
const dirTree = require("directory-tree");
var uniqid = require("uniqid");
var router = express.Router();
var pretty = require("express-prettify");
const https = require("https");
var cors = require("cors");
const bodyParser = require("body-parser");
const redis = require("redis");
const client = redis.createClient();
const os = require("os");
const config = require("./config.json");
const fetch = require('node-fetch');
const request = require('request');
const YAML = require('yaml');
class repo {
  constructor() {
    this.path = ""; // where on disk the repo is cloned
    this.id = ""; // the unique id for the repo
    this.rawpath = ""; // the raw path of github files
    this.branch = "master";
    this.url = ""; // the repo url
    this.name = "";
    this.tmpdir = "";
  }
}
router.use(bodyParser.json());
router.use(bodyParser.urlencoded({ extended: true }));
router.use(
  pretty({
    query: "pretty"
  })
);

// Add a simple test endpoint
router.get("/", function(req, res) {
  const timestamp = new Date().toISOString();
  console.log(`🏠 [${timestamp}] Root endpoint accessed`);
  res.json({
    status: "GitAPI Server is running!",
    timestamp: timestamp,
    endpoints: {
      clone: "/clone/:repo/:branch?",
      health: "/health"
    }
  });
});

// Add a health check endpoint
router.get("/health", function(req, res) {
  const timestamp = new Date().toISOString();
  console.log(`❤️ [${timestamp}] Health check accessed`);
  res.json({
    status: "healthy",
    timestamp: timestamp,
    redis: "connected",
    git: shell.which("git") ? "available" : "not available"
  });
});
var corsOptions = {
  origin: function(origin, callback) {
    callback(null, true);
/*     if (config.whitelist.indexOf(origin) !== -1) {
       callback(null, true);
     } else {
       console.log(`Not allowed by CORS ${origin}`);
       callback(new Error(`Not allowed by CORS ${origin}`));
     } */
  }
};

router.get("/clone/:repo/:branch?", cors(corsOptions), async function(
  req,
  res,
  next
) {
  const timestamp = new Date().toISOString();
  console.log(`\n🚀 [${timestamp}] CLONE REQUEST STARTED`);
  console.log(`📋 Params:`, req.params);
  console.log(`❓ Query:`, req.query);
  
  var origin = req.get("origin");
  console.log("🌐 ORIGIN", origin);

  let myrepo = new repo();
  myrepo.tmpdir = os.tmpdir();
  myrepo.branch =
    typeof req.params == `undefined` ? `master` : req.params.branch;
    
  console.log(`📂 Using temp directory: ${myrepo.tmpdir}`);
  console.log(`🌿 Branch: ${myrepo.branch}`);
    
  if (!shell.which("git")) {
    console.log(`❌ Git not available!`);
    res.status(500).send("Git not available");
    return;
  }
  console.log(`✅ Git is available`);

  myrepo.url = `https://github.com/${req.params.repo}`;
  myrepo.rawpath = `https://raw.githubusercontent.com/${req.params.repo}/${req.params.branch}/`;
  myrepo.name = req.params.repo;
  
  console.log(`🔗 Repository URL: ${myrepo.url}`);
  console.log(`📁 Repository name: ${myrepo.name}`);
  console.log(`🗂️ Raw path: ${myrepo.rawpath}`);

  // get the data from redis, it retuns a path
  console.log(`🔍 Checking Redis for: ${myrepo.name}/${myrepo.branch}`);
  client.get(`${myrepo.name}/${myrepo.branch}`, function(e, pathInRedis) {
    if (e) {
      console.log(`❌ Redis error:`, e);
    }
    myrepo.path = pathInRedis;
    console.log("📍 Path in redis:", myrepo.path);
    let tree;
    if (myrepo.path != null) {
      console.log(`✅ Found cached path, checking if directory exists...`);
      // if there is data in redis, we check if the cloned repo exists
      tree = dirTree(myrepo.path, {
        exclude: /.git/,
        extensions: /\.(md|sol|js)$/
      });
      console.log(`📊 Directory tree result:`, tree ? 'Found' : 'Not found');
    } else {
      console.log(`❌ No cached path found in Redis`);
    }

    // we have cloned data, get the tree
    if (myrepo.path != null && tree != null) {
      shell.cd(myrepo.path);
      console.log(myrepo.path);
      console.log(shell.pwd());
      const cmd = `git pull`; // get the updates
      shell.exec(cmd, async function(code, stdout, stderr) {
        console.log("just getting the tree", myrepo.path, stdout, stderr);
        await sendTreeToOutput(myrepo, res);
        console.log("all done");
      });
    } else {
      myrepo.id = uniqid(); // assign new id to this repo
      myrepo.path = `${myrepo.tmpdir}/${myrepo.id}`;
      console.log("cloning", myrepo.url);
      console.log(shell.pwd());
      const cmd = `git clone --depth 1 --single-branch --branch ${myrepo.branch} ${myrepo.url} ${myrepo.path}`;
      console.log(cmd, myrepo.path);

      shell.exec(cmd, async function(code, stdout, stderr) {
        const tree = dirTree(myrepo.path, {
          exclude: /.git/,
          extensions: /\.(md|sol|js|vy)$/
        });
        if (tree == null) {
          res.status(404).send("Repo is empty or does not exist");
          return;
        }
        console.log("cloning is done");
        await sendTreeToOutput(myrepo, res);
        client.set(`${myrepo.name}/${myrepo.branch}`, `${myrepo.path}`); // store in redis
        console.log("redis updated");
      });
    }
  });
});

const sendTreeToOutput = async (myrepo, res) => {
  console.log("🌳 Building tree for:", myrepo.path);
  let workshops = getTree(myrepo); // build the tree
  console.log("📊 Initial workshops object:", workshops);
  
  await parseFiles(workshops, myrepo);
  console.log("📄 After parseFiles:", workshops);
  
  await groupWorkShops(workshops);
  console.log("📋 After groupWorkShops:", workshops);
  

  Object.keys(workshops.sorted).map(k => (console.log("🔍 Workshop item:", workshops.sorted[k])));

  // Safety check for empty workshops.sorted
  let entities = {};
  let ids = [];
  
  if (workshops.sorted && Object.keys(workshops.sorted).length > 0) {
    console.log("✅ Found workshops to process");
    entities = Object.assign(
      ...Object.keys(workshops.sorted).map(k => ({
        [workshops.sorted[k].id]: workshops.sorted[k]
      }))
    );
    ids = Object.keys(entities).map(k => k);
  } else {
    console.log("⚠️  No workshops found or workshops.sorted is empty");
    console.log("📊 workshops.sorted:", workshops.sorted);
  }

  console.log("🎯 Final entities:", entities);
  console.log("🆔 Final ids:", ids);

  console.log(workshops.sorted)
  const getDateCmd = `git log -1 --format=%cd`; // command to get the date of the last commit
  shell.cd(`${myrepo.path}`);
  shell.exec(getDateCmd, function(code, stdout, stderr) {
    console.log(stderr, stdout, myrepo.path);
    workshops.datemodified = stdout;
    res.json({ids:ids, entities:entities, datemodified:stdout });
  });
  shell.cd("/");
  console.log("output done"); // do this otherwise the shell gets stuck if dir gets deleted
};

const groupWorkShops = async (workshops) =>{

  let groups = {};
  workshops.sorted = [];
  console.log(workshops);

  
  for (let index = 0; index < workshops.length; index++){
    let ob = workshops[index];
    if(!groups[ob.level]) groups[ob.level] = [];
    groups[ob.level].push(ob);
  }
  // sort on alphabet within each level group
  
  for (let property in groups) {
    groups[property].sort(compareName);
  }
  for (let property in groups) {
    for(let index in groups[property]){
      console.log(groups[property][index]);
      workshops.sorted.push(groups[property][index]);
    }
  }
  console.log(groups);

  
  //console.log(workshops);
  console.log("sorting done");

}

const parseFiles = async (workshops, myrepo) =>{
  
  console.log(workshops.length);
  for (let index = 0; index < workshops.length; index++){
    let ob = workshops[index];
    //console.log(ob);
    if(typeof ob.description != "undefined"){
      console.log(ob.description);
      let html = await downloadPage(ob.description.file);
      console.log(ob.description.file);
      workshops[index].description.content = html;
    }
    if(typeof ob.metadata != "undefined"){
      let html = await downloadPage(ob.metadata.file);
      let metadata = YAML.parse(html);
      workshops[index].repo = myrepo;
      workshops[index].metadata.data = metadata;
      if(typeof metadata.name != "undefined") workshops[index].name = metadata.name;
      if(typeof metadata.level != "undefined") {workshops[index].level = metadata.level} else {workshops[index].level=999999};
    }else{
      workshops[index].level=999999;
    }
  }

    
/*     if(typeof ob.steps != "undefined"){
      for (let index2 = 0; index2 < ob.steps.length; index2++){
        let filetypes = ["markdown","solidity","test","js","answer","vy"];
        for (let filetype of filetypes) {
        if(typeof ob.steps[index2][filetype] != "undefined"){
          let html = await downloadPage(ob.steps[index2][filetype].file);
          console.log(ob.steps[index2][filetype].file);
          workshops.entities[element].steps[index2][filetype].content = html;
        }
      }
    }
    } */
 // };
  console.log("fetching done"); 
}

function compareName( a, b ) {
  //console.log(a,b);
  if ( a.name < b.name ){
    return -1;
  }
  if ( a.name > b.name ){
    return 1;
  }
  return 0;
}

function downloadPage(url) {
  return new Promise((resolve, reject) => {
      request(url, (error, response, body) => {
          if (error) reject(error);
          if (response.statusCode != 200) {
              reject('Invalid status code <' + response.statusCode + '>');
          }
          resolve(body);
      });
  });
}

const getTree = myrepo => {
  console.log("🌳 Starting getTree for path:", myrepo.path);
  
  const tree = dirTree(myrepo.path, {
    exclude: /.git/,
    extensions: /\.(md|sol|js|yml|vy)$/
  });

  console.log("📁 Directory tree result:", tree);
  
  if (!tree || !tree.children) {
    console.log("❌ No tree or children found");
    return [];
  }

  console.log("📂 Found", tree.children.length, "items in root directory");
  
  const rawpath = myrepo.rawpath;

  const workshops = tree.children // children are the directories with workshops
    .filter(file => {
      const isDirectory = file.children && Array.isArray(file.children);
      console.log("🔍 Checking item:", file.name, "is directory:", isDirectory, "has children:", file.children ? file.children.length : 0);
      return isDirectory;
    })
    .map(element => {
      console.log("📋 Processing workshop directory:", element.name);
      return {
        name: element.name, // name of the workshop dir
        id: uniqid(),
        //type: element.type,
        description: (typeof element.children != "undefined"
          ? element.children
          : []
        )
          .filter(file => file.name && file.name.endsWith('.md'))
          .map(file => ({
            file: `${rawpath}${element.name}/${file.name}`
          }))
          .values()
          .next().value,
        metadata: (typeof element.children != "undefined" ? element.children : [])
          .filter(file => file.name == "config.yml")
          .map(file => ({
            file: `${rawpath}${element.name}/${file.name}`
          }))
          .values()
          .next().value,
        steps: (typeof element.children != "undefined" ? element.children : []) // steps subdirectories but only when not empty
          .filter(file => file.children && Array.isArray(file.children))
          .map(stepchild => ({
            name: stepchild.name, // name of step directory
            //type: stepchild.type,
            markdown: (typeof stepchild.children != "undefined"
              ? stepchild.children
              : []
            ) // go through files in step directory
              .filter(file => file.name && file.name.endsWith('.md'))
              .map(file => ({
                file: `${rawpath}${element.name}/${stepchild.name}/${file.name}`
              }))
              .values()
              .next().value,
            test: (typeof stepchild.children != "undefined"
              ? stepchild.children
              : []
            )
              .filter(file => file.name && file.name.endsWith('.sol'))
              .filter(file => file.name.includes("_test"))
              .filter(file => !file.name.includes("_answer"))
              .map(file => ({
                file: `${rawpath}${element.name}/${stepchild.name}/${file.name}`
              }))
              .values()
              .next().value,
            answer: (typeof stepchild.children != "undefined"
              ? stepchild.children
              : []
            )
              .filter(file => file.name && file.name.endsWith('.sol'))
              .filter(file => file.name.includes("_answer"))
              .map(file => ({
                file: `${rawpath}${element.name}/${stepchild.name}/${file.name}`
              }))
              .values()
              .next().value,
            solidity: (typeof stepchild.children != "undefined"
              ? stepchild.children
              : []
            )
              .filter(file => file.name && file.name.endsWith('.sol'))
              .filter(file => !file.name.includes("_test"))
              .filter(file => !file.name.includes("_answer"))
              .map(file => ({
                file: `${rawpath}${element.name}/${stepchild.name}/${file.name}`
              }))
              .values()
              .next().value,
            js: (typeof stepchild.children != "undefined"
              ? stepchild.children
              : []
            )
              .filter(file => file.name && file.name.endsWith('.js'))
              .filter(file => !file.name.includes("_test"))
              .map(file => ({
                file: `${rawpath}${element.name}/${stepchild.name}/${file.name}`
              }))
              .values()
              .next().value,
            vy: (typeof stepchild.children != "undefined"
              ? stepchild.children
              : []
            )
              .filter(file => file.name && file.name.endsWith('.vy'))
              .filter(file => !file.name.includes("_test"))
              .map(file => ({
                file: `${rawpath}${element.name}/${stepchild.name}/${file.name}`
              }))
              .values()
              .next().value
          }))
      };
    });  console.log("📊 Final workshops array:", workshops);
  console.log("📈 Total workshops found:", workshops.length);

/*   let entities = Object.assign(
    ...Object.keys(workshops).map(k => ({
      [workshops[k].id]: workshops[k]
    }))
  );
  let ids = Object.keys(entities).map(k => k); */

  return workshops;
};

module.exports = router;
