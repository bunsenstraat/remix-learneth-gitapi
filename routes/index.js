var express = require('express');
const shell = require('shelljs');
const dirTree = require("directory-tree");
var uniqid = require('uniqid');
const util = require('util')
var router = express.Router();
var pretty = require('express-prettify');
const http = require('http');
const https = require('https');
const fse = require('fs-extra');
var cors = require('cors');
const bodyParser = require('body-parser');
const redis = require("redis");
const client = redis.createClient();

router.use(bodyParser.json());
router.use(bodyParser.urlencoded({extended: true}) );
router.use(pretty({
  query: 'pretty'
}));
router.use(cors())
router.post('/getfile',function(req,response,next){
  let data;
  https.get(req.body.file, (res) => {
    res.on('data', (d) => {
      data = d
      console.log(d);
      response.write(d);
      response.send();
    });
  }).on('error', (e) => {
    console.error(e);
  });
});

router.get('/test/',function(req,res,next){
  res.write("testing");
  res.send();
  return;
  res.write("testing2");
});

router.get('/clone/:repo/:branch?', function (req, res, next) {
  const path = '/tmp'
  req.params.branch = (typeof req.params==`undefined`)?`master`:req.params.branch
  if (!shell.which('git')) {
    res.status(500).send('Git not available')
  } else {
    const id = uniqid();
    const url = `https://github.com/${req.params.repo}`;
    const rawpath = `https://raw.githubusercontent.com/${req.params.repo}/${req.params.branch}/`;

    client.get(`${req.params.repo}/${req.params.branch}`,function(e,v){ // get the data from redis
      console.log(e,v,path,id);
      let tree;
      if(v!=null){
        tree = dirTree(v, {
          exclude: /.git/,
          extensions: /\.(md|sol|js)$/
        }); 
        console.log(tree);       
      }
     
      if(v!=null && tree!=null){
        shell.cd(v) 
        console.log(v);
        const cmd = `git pull`
        shell.exec(cmd, function (code, stdout, stderr) {
          console.log("just getting the tree",v,stdout,stderr);
          const workshops = getTree(v, '', rawpath);
          const getDateCmd = `git log -1 --format=%cd`;
          shell.exec(getDateCmd, function (code, stdout, stderr) {
            workshops.datemodified = stdout;
            res.json(workshops);
          });
        });
      }else{
        console.log("cloning",`${path}/${id}`);
        
        shell.cd(path)    
        const cmd = `git clone --single-branch --branch ${req.params.branch} ${url} ${id}`;
        shell.exec(cmd, function (code, stdout, stderr) {   
          const tree = dirTree(path + "/" + id, {
            exclude: /.git/,
            extensions: /\.(md|sol|js)$/
          });
          if (tree == null) {
            res.status(404).send('Repo is empty or does not exist')
          } else {
            const workshops = getTree(path,id, rawpath);
            client.set(`${req.params.repo}/${req.params.branch}`,`${path}/${id}`); // store in redis
            const getDateCmd = `git log -1 --format=%cd`; // command to get the date of the last commit
            shell.cd(`${path}/${id}`);
            shell.exec(getDateCmd, function (code, stdout, stderr) {
              console.log(stderr,stdout,path);
              workshops.datemodified = stdout;
              res.json(workshops);
            });
            
          }
        });
      }
    })
  }
})

const getTree = (path,id, rawpath)=>{

  const tree = dirTree(path + "/" + id, {
    exclude: /.git/,
    extensions: /\.(md|sol|js|yml)$/
  });

  const workshops =
  tree.children // children are the directories with workshops
  .filter(file => (file.type == 'directory'))
  .map(element => ({
    name: element.name, // name of the workshop dir
    id: uniqid(),
    //type: element.type,
    description: ((typeof element.children != "undefined") ? element.children : [])
      .filter(file => (file.extension == '.md'))
      .map(file => ({
        file: `${rawpath}${element.name}/${file.name}`
      })).values().next().value
      ,
    metadata: ((typeof element.children != "undefined") ? element.children : [])
      .filter(file => (file.name == 'config.yml'))
      .map(file => ({
        file: `${rawpath}${element.name}/${file.name}`
      })).values().next().value
      ,
    steps: ((typeof element.children != "undefined") ? element.children : []) // steps subdirectories but only when not empty
      .filter(file => (file.type == 'directory'))
      .map(stepchild => ({
        name: stepchild.name, // name of step directory 
        //type: stepchild.type,
        markdown: ((typeof stepchild.children != "undefined") ? stepchild.children : []) // go through files in step directory
          .filter(
            file => (file.extension == '.md')
          )
          .map(
            file => ({
              file: `${rawpath}${element.name}/${stepchild.name}/${file.name}`
            })
          ).values().next().value,
        test: ((typeof stepchild.children != "undefined") ? stepchild.children : [])
          .filter(
            file => (file.extension == '.sol')
          )
          .filter(
            file => (file.name.includes('_test'))
          )
          .map(
            file => ({
              file: `${rawpath}${element.name}/${stepchild.name}/${file.name}`
            })
          ).values().next().value,
        solidity: ((typeof stepchild.children != "undefined") ? stepchild.children : [])
          .filter(
            file => (file.extension == '.sol')
          )
          .filter(
            file => (!file.name.includes('_test'))
          )
          .map(
            file => ({
              file: `${rawpath}${element.name}/${stepchild.name}/${file.name}`
            })
          ).values().next().value,
        js: ((typeof stepchild.children != "undefined") ? stepchild.children : [])
          .filter(
            file => (file.extension == '.js')
          )
          .filter(
            file => (!file.name.includes('_test'))
          )
          .map(
            file => ({
              file: `${rawpath}${element.name}/${stepchild.name}/${file.name}`
            })
          ).values().next().value,
      }))
  }));

  let entities = Object.assign(...Object.keys(workshops).map(k => ({
    [workshops[k].id]: workshops[k]
  })));
  let ids = Object.keys(entities).map((k) => k);

  return {ids:ids, entities:entities};


}


module.exports = router;