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
var corsOptions = {
  origin: function(origin, callback) {
    //callback(null, true);
    if (config.whitelist.indexOf(origin) !== -1) {
       callback(null, true);
     } else {
       console.log(`Not allowed by CORS ${origin}`);
       callback(new Error(`Not allowed by CORS ${origin}`));
     }
  }
};

router.get("/clone/:repo/:branch?", cors(corsOptions), async function(
  req,
  res,
  next
) {
  var origin = req.get("origin");
  console.log(origin);

  let myrepo = new repo();
  myrepo.tmpdir = os.tmpdir();
  myrepo.branch =
    typeof req.params == `undefined` ? `master` : req.params.branch;
  if (!shell.which("git")) {
    res.status(500).send("Git not available");
    return;
  }

  myrepo.url = `https://github.com/${req.params.repo}`;
  myrepo.rawpath = `https://raw.githubusercontent.com/${req.params.repo}/${req.params.branch}/`;
  myrepo.name = req.params.repo;

  // get the data from redis, it retuns a path
  client.get(`${myrepo.name}/${myrepo.branch}`, function(e, pathInRedis) {
    myrepo.path = pathInRedis;
    console.log("path in redis ", myrepo.path);
    let tree;
    if (myrepo.path != null) {
      // if there is data in redis, we check if the cloned repo exists
      tree = dirTree(myrepo.path, {
        exclude: /.git/,
        extensions: /\.(md|sol|js)$/
      });
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
      const cmd = `git clone --single-branch --branch ${myrepo.branch} ${myrepo.url} ${myrepo.path}`;
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
  console.log("build tree", myrepo.path);
  const workshops = getTree(myrepo); // build the tree
  await parseFiles(workshops, myrepo);
  const getDateCmd = `git log -1 --format=%cd`; // command to get the date of the last commit
  shell.cd(`${myrepo.path}`);
  shell.exec(getDateCmd, function(code, stdout, stderr) {
    console.log(stderr, stdout, myrepo.path);
    workshops.datemodified = stdout;
    res.json(workshops);
  });
  shell.cd("/");
  console.log("output done"); // do this otherwise the shell gets stuck if dir gets deleted
};

const parseFiles = async (workshops, myrepo) =>{
  
  for (let index = 0; index < workshops.ids.length; index++){
    let element = workshops.ids[index];
    let ob = workshops.entities[element];
    if(typeof ob.description != "undefined"){
      console.log(ob.description);
      let html = await downloadPage(ob.description.file);
      console.log(ob.description.file);
      workshops.entities[element].description.content = html;
    }
    if(typeof ob.metadata != "undefined"){
      console.log(ob.metadata);
      let html = await downloadPage(ob.metadata.file);
      console.log(ob.metadata.file);
      let metadata = YAML.parse(html);
      workshops.entities[element].repo = myrepo;
      workshops.entities[element].metadata.data = metadata;
      if(typeof metadata.name != "undefined") workshops.entities[element].name = metadata.name;
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
  };
  console.log("fetching done"); 
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
  const tree = dirTree(myrepo.path, {
    exclude: /.git/,
    extensions: /\.(md|sol|js|yml|vy)$/
  });

  const rawpath = myrepo.rawpath;

  const workshops = tree.children // children are the directories with workshops
    .filter(file => file.type == "directory")
    .map(element => ({
      name: element.name, // name of the workshop dir
      id: uniqid(),
      //type: element.type,
      description: (typeof element.children != "undefined"
        ? element.children
        : []
      )
        .filter(file => file.extension == ".md")
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
        .filter(file => file.type == "directory")
        .map(stepchild => ({
          name: stepchild.name, // name of step directory
          //type: stepchild.type,
          markdown: (typeof stepchild.children != "undefined"
            ? stepchild.children
            : []
          ) // go through files in step directory
            .filter(file => file.extension == ".md")
            .map(file => ({
              file: `${rawpath}${element.name}/${stepchild.name}/${file.name}`
            }))
            .values()
            .next().value,
          test: (typeof stepchild.children != "undefined"
            ? stepchild.children
            : []
          )
            .filter(file => file.extension == ".sol")
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
            .filter(file => file.extension == ".sol")
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
            .filter(file => file.extension == ".sol")
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
            .filter(file => file.extension == ".js")
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
            .filter(file => file.extension == ".vy")
            .filter(file => !file.name.includes("_test"))
            .map(file => ({
              file: `${rawpath}${element.name}/${stepchild.name}/${file.name}`
            }))
            .values()
            .next().value
        }))
    }));

  let entities = Object.assign(
    ...Object.keys(workshops).map(k => ({
      [workshops[k].id]: workshops[k]
    }))
  );
  let ids = Object.keys(entities).map(k => k);

  return { ids: ids, entities: entities };
};

module.exports = router;
