var express = require('express');
const shell = require('shelljs');
const dirTree = require("directory-tree");
var uniqid = require('uniqid');
const util = require('util')
var router = express.Router();
var pretty = require('express-prettify');
const http = require('http');
const fse = require('fs-extra');
var cors = require('cors')

router.use(pretty({
  query: 'pretty'
}));

router.use(cors())

router.get('/clone/:repo/:branch?', function (req, res, next) {

  const path = '/tmp'
  if(typeof req.params=="undefined"){
    req.params.branch = `master`;
  }

  if (!shell.which('git')) {
    res.status(500).send('Git not available')

  } else {
    const id = uniqid();
    const url = `https://github.com/${req.params.repo}`;
    const rawpath = `https://raw.githubusercontent.com/${req.params.repo}/${req.params.branch}/`;
    shell.cd(path)
    const cmd = `git clone --single-branch --branch ${req.params.branch} ${url} ${id}`;
    shell.exec(cmd, function (code, stdout, stderr) {

      const tree = dirTree(path + "/" + id, {
        exclude: /.git/,
        extensions: /\.(md|sol|js)$/
      });
      if (tree == null) {
        res.status(500).send('Repo is empty or does not exist')
      } else {
        const workshops =
          tree.children // children are the directories with workshops
          .map(element => ({
            name: element.name, // name of the workshop dir
            //type: element.type,
            description: ((typeof element.children != "undefined") ? element.children : [])
              .filter(file => (file.extension == '.md'))
              .map(file => Promise.all([fse.readFile(file.path,"utf8").then( c => { return c } )]))
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
        //  let newObj = Object.fromEntries(workshops.map((el) => [uniqid(), el]));
        let entities = Object.assign(...Object.keys(workshops).map(k => ({
          [uniqid()]: workshops[k]
        })));
        let ids = Object.keys(entities).map((k) => k);
        //console.log(util.inspect(workshops));
        const rm = `rm -rf ${path}/${id}`;
        shell.exec(rm);
        res.json({
          entities: entities,
          ids: ids
        });
      }
    });
  }


})
module.exports = router;