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

class repo {
  constructor(){
    this.path = "" // where on disk the repo is cloned
    this.id = "" // the unique id for the repo
    this.rawpath = "" // the raw path of github files
    this.branch = "master"
    this.url = "" // the repo url
    this.name = ""
    this.tmpdir = ""
  }

}


router.use(bodyParser.json());
router.use(bodyParser.urlencoded({ extended: true }));
router.use(
  pretty({
    query: "pretty"
  })
);
router.use(cors());
router.post("/getfile", function(req, response, next) {
  let data;
  https
    .get(req.body.file, res => {
      res.on("data", d => {
        data = d;
        console.log(d);
        response.write(d);
        response.send();
      });
    })
    .on("error", e => {
      console.error(e);
    });
});

router.get("/clone/:repo/:branch?", function(req, res, next) {

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
  client.get(`${myrepo.name}/${myrepo.branch}`, function(
    e,
    pathInRedis
  ) {
    myrepo.path = pathInRedis;
    console.log("path in redis ",myrepo.path)
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
      shell.exec(cmd, function(code, stdout, stderr) {
        console.log("just getting the tree", myrepo.path, stdout, stderr);
        sendTreeToOutput(myrepo,res);
      });
    } else {
      
      myrepo.id = uniqid(); // assig new id to this repo
      myrepo.path = `${myrepo.tmpdir}/${myrepo.id}`
      console.log("cloning", myrepo.url);
      console.log(shell.pwd());
      const cmd = `git clone --single-branch --branch ${myrepo.branch} ${myrepo.url} ${myrepo.path}`;
      console.log(cmd, myrepo.path);

      shell.exec(cmd, function(code, stdout, stderr) {
        const tree = dirTree(myrepo.path, {
          exclude: /.git/,
          extensions: /\.(md|sol|js)$/
        });
        if (tree == null) {
          res.status(404).send("Repo is empty or does not exist");
          return;
        }
        console.log("cloning is done");
        sendTreeToOutput(myrepo,res);
        client.set(`${myrepo.name}/${myrepo.branch}`, `${myrepo.path}`); // store in redis
      });
    }
  });
});

const sendTreeToOutput = (myrepo,res)=>{
  console.log("build tree", myrepo.path);
  const workshops = getTree(myrepo); // build the tree
  const getDateCmd = `git log -1 --format=%cd`; // command to get the date of the last commit
  shell.cd(`${myrepo.path}`);
  shell.exec(getDateCmd, function(code, stdout, stderr) {
    console.log(stderr, stdout, myrepo.path);
    workshops.datemodified = stdout;
    res.json(workshops);
  });
  shell.cd("/");// do this otherwise the shell gets stuck if dir gets deleted
}

const getTree = (myrepo) => {
  const tree = dirTree(myrepo.path, {
    exclude: /.git/,
    extensions: /\.(md|sol|js|yml)$/
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
