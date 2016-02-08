'use strict';

// Uncomment this if you need to use Set, Map, generators etc.
// import 'babel/polyfill';

import oHoverable from 'o-hoverable';
import d3 from 'd3';
import oHeader from 'o-header';
import THREE from 'three.js';
import topojson from 'topojson';
import TWEEN from 'tween.js';

var OrbitControls = require('three-orbit-controls')(THREE);

oHoverable.init(); // makes hover effects work on touch devices

document.addEventListener('DOMContentLoaded', function () {
  oHoverable.init(); // makes hover effects work on touch devices

  var dataset=spreadsheet.data;
  var exports=spreadsheet.exports;
  var imports=spreadsheet.imports;
  var options=spreadsheet.options;

  var formatNumber = d3.format(".3n");
  var firstRun=true;
  var startLat=39;
  var startLon=-98;
  var endLon=0;
  var endLat=0;
  var posX = 200;
  var posY = 600;
  var posZ = 1800;
  var width = document.getElementById('globeDiv').getBoundingClientRect().width;
  var height = 400;
  var controls;
  var numTrades=20;
  var linesData=[];//Array that is passed to the curve function containing vertices for creating beziers
  var imEx="exports"
  var FOV = 45;
  var NEAR = 2;
  var FAR = 4000;
  var raycaster = new THREE.Raycaster();
  var sourceISO


  var renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setSize(width,height);
  renderer.setClearColor( 0xfff1e0, 1);
  // add it to the target element
  var globeDiv = document.getElementById("globeDiv");
  globeDiv.appendChild(renderer.domElement);

  // setup a camera that points to the center
  var camera = new THREE.PerspectiveCamera(FOV,width/height,NEAR,FAR);
  camera.position.set(posX,posY,posZ);
  camera.lookAt(new THREE.Vector3(0,0,0));

  // create a basic scene and add the camera
  var scene = new THREE.Scene();

  //spotlight set up in the same location as the camera
  var soptlight = new THREE.SpotLight(0xffffff, 0.4,0,65);
  soptlight.position.set(posX,posY,posZ);

  var light = new THREE.HemisphereLight('#ffffff', '#000000', 0.85);
  light.position.set(100, 1000, 0);
  scene.add(light);


  controls = new OrbitControls(camera,renderer.domElement );
  //controls.enableDamping = true;
  //controls.dampingFactor = 0.25;
  controls.enableZoom = true;

  var globeRadius=650;
  var curveObject;

  var projection = d3.geo.equirectangular()  //A
  .translate([2048, 1024]).scale(652);

  var scourceText=spreadsheet.credits.filter(function(el){return el.type==="source"});
  var sourceString="Source: ";
  for ( var i = 0; i < scourceText.length; i++) {
    sourceString=sourceString+"<a href='"+scourceText[i].url+"'>"+scourceText[i].name+"</a>; ";
  }
  var creditText=spreadsheet.credits.filter(function(el){return el.type==="credit"});     
  var creditString="Graphic: ";
  for (var i = 0; i < creditText.length; i++) {
    creditString=creditString+"<a href='"+creditText[i].url+"'>"+creditText[i].name+"</a>; ";
  }
  creditString=creditString.slice(0, creditString.lastIndexOf("; "));

  d3.select("#mainTitle").html(options.title);
  d3.select("#graphsubhead").html(options.introText);
  d3.select(".source").html(sourceString);
  d3.select(".credits").html(creditString);



  d3.json('data/10m.json', function (err, data) { //B
    var currentCountry;
    var overlay;
    var currentPoint;
    var segments = 300; // number of vertices. Higher = better mouse accuracy

    // Setup cache for country textures
    var countries = topojson.feature(data, data.objects.countries);
    //console.log(countries);
    var geo = geodecoder(countries.features);

    var textureCache = memoize(function (cntryID, color) {
      var country = geo.find(cntryID);
      return mapTexture(country, color);
    });

    // Base globe with grey "water" material
    var earthGeo = new THREE.SphereGeometry(globeRadius, segments, segments);
    var earthMat=new THREE.MeshPhongMaterial();
    earthMat.map=THREE.ImageUtils.loadTexture("images/world.jpg");
    earthMat.bumpMap=THREE.ImageUtils.loadTexture("images/bumpmap.jpg");
    earthMat.bumpScale=9;
    earthMat.shininess=6;
    var baseGlobe = new THREE.Mesh(earthGeo, earthMat);
    baseGlobe.addEventListener('mousedown', loadTrade);
    baseGlobe.addEventListener('mousemove', onGlobeMousemove);

    // add base map layer with all countries
    var worldTexture = mapTexture(countries, '#7fd8f5');
    var mapMaterial  = new THREE.MeshPhongMaterial({map: worldTexture, transparent: true});
    //Holds the country tube arcs. Put in here so that it is effected by rotation in animate function from the beginning
    var lineObject = new THREE.Object3D();


    // create a container node and add the two meshes
    var ftWorld = new THREE.Object3D();
    ftWorld.add(baseGlobe);
    scene.add(ftWorld);
    scene.add(soptlight);
    scene.add(camera);

    setEvents(camera, [baseGlobe], 'mousedown');
    setEvents(camera, [baseGlobe], 'mousemove', 10);

    d3.selectAll(".o-buttons")
    .on("click", buttonClick)

    function buttonClick() {
      console.log("buttonClick",this.id)
      imEx=this.id.toString()
      console.log(imEx)
      if (firstRun==false){
        if (imEx=="exports"){
        filter(exports,2014,sourceISO);
       }
       else {filter(imports,2014,sourceISO)};
       //console.log("dateFiletr",linesData);
       curveData();
       addLines();
      }
    }

  // takes lon lat and a radius and turns that into vector
  function makeCurve(startLon,startLat,endLon,endLat,thickness){
    var widthScale = d3.scale.linear()
                .domain([0, 500000000000])
                .range([1, 80]);
    
    var vF = to3DVector(startLon, startLat, globeRadius);
    var vT = to3DVector(endLon, endLat, globeRadius);
    // then you get the half point of the vectors points.
    var xC = ( 0.5 * (vF.x + vT.x) );
    var yC = ( 0.5 * (vF.y + vT.y) );
    var zC = ( 0.5 * (vF.z + vT.z) );
    // then we create a vector for the midpoints.
    var mid = new THREE.Vector3(xC, yC, zC);

    var dist = vF.distanceTo(vT);
    // here we are creating the control points for the first ones.
    // the 'c' in front stands for control.
    var cvT = vT.clone();
    var cvF = vF.clone();
    var smoothDist = map(dist, 0, 10, 0, 15/dist );
    mid.setLength( globeRadius * smoothDist );

    cvT.add(mid);
    cvF.add(mid);
     
    cvT.setLength( globeRadius * smoothDist );
    cvF.setLength( globeRadius * smoothDist );

    var curve = new THREE.CubicBezierCurve3( vF, cvF, cvT, vT );
    //create the tube structure
    var tube= new THREE.TubeGeometry(curve,50,widthScale(thickness),20,false)
    curveObject=new THREE.Mesh(tube,new THREE.MeshBasicMaterial({
      opacity:0.7,
      color : 0xff0000,
      transparent:true,
    }));
    curveObject.addEventListener('mouseover', curveOver);

    function map(value, low1, high1, low2, high2) {
      return low2 + (high2 - low2) * (value - low1) / (high1 - low1);
    }
  }

  function to3DVector(lon, lat, radius) {
    var phi = lat * Math.PI / 180;
    var theta = (lon + 90) * Math.PI / 180;
    var xF = globeRadius * Math.cos(phi) * Math.sin(theta);
    var yF = globeRadius * Math.sin(phi);
    var zF = globeRadius * Math.cos(phi) * Math.cos(theta);
    return new THREE.Vector3(xF, yF, zF);
  }

    animate();

    function geodecoder(features) {
      let store = {};

      for (let i = 0; i < features.length; i++) {
        store[features[i].id] = features[i];
      }

      return {
        find: function (id) {
          return store[id];
        },
        search: function (lat, lng) {
          var match = false;
          var country, coords;
          for (var i = 0; i < features.length; i++) {
            country = features[i];
            if(country.geometry.type === 'Polygon') {
              match = pointInPolygon(country.geometry.coordinates[0], [lng, lat]);
              if (match) {
                return {
                  code: features[i].id,
                  name: features[i].properties.name
                };
              }
            } else if (country.geometry.type === 'MultiPolygon') {
              coords = country.geometry.coordinates;
              for (let j = 0; j < coords.length; j++) {
                match = pointInPolygon(coords[j][0], [lng, lat]);
                if (match) {
                  return {
                    code: features[i].id,
                    name: features[i].properties.name
                  };
                }
              }
            }
          }
          return null;
        }
      };
    }

    // adapted from memoize.js by @philogb and @addyosmani
    function memoize(fn) {
      return function () {
        var args = Array.prototype.slice.call(arguments);
        var key = "", len = args.length, cur = null;
        while (len--) {
          cur = args[len];
          key += (cur === Object(cur))? JSON.stringify(cur): cur;

          fn.memoize || (fn.memoize = {});
        }
        return (key in fn.memoize)? fn.memoize[key]:
        fn.memoize[key] = fn.apply(this, args);
      };
    }

    function loadTrade(event) {
      //console.log("loadTrade");

      var latlng = getEventCenter.call(this, event);
      var country = geo.search(latlng[0], latlng[1]);
      if (country){
        sourceISO=country.code;
      }
     //console.log ("Clicked country code= ",sourceISO);
     var sourceCountry=dataset.filter(function(el){
       return el.isocode===sourceISO;
     });
     //console.log("sourceCountry=",sourceCountry)
     startLat=sourceCountry[0].lat;
     startLon=sourceCountry[0].lon;
     var imfCode=sourceCountry[0].imfcode;
     var headinfo=d3.select("#infoHead")
     headinfo.html("   "+sourceCountry[0].ftname+"’s top 20 export partners")

     //Filtering by date
     if (imEx=="exports"){
      filter(exports,2014,sourceISO);
     }
     else {filter(imports,2014,sourceISO)};
     //console.log("dateFiletr",linesData);
     curveData();
     addLines();

     //console.log ("lat and lon= ",sourceCountry[0].name,startLat,startLon,imfCode);
  
    }

    function filter(data,filterDate,countryFilter) {
      //console.log("dateFilter");
      linesData=data.filter(function(el){
        return el.timecode==filterDate && el.sourceiso==countryFilter;
      });
    }
    
    //fills the lineObject array with the information needed to build the curve lines
    function curveData() {
      //console.log("curveData");
      for (var i = 0; i < linesData.length; i++) { 
          //console.log("Target imf ",linesData[i].partnercountrycode);
          var targetCounty=dataset.filter(function(el){
            return el.imfcode==linesData[i].partnercountrycode;
          });
          //console.log("Target ",targetCounty);
          linesData[i].lon=targetCounty[0].lon;
          linesData[i].lat=targetCounty[0].lat;
          //console.log("linesdata",linesData[i])
         }
         linesData=linesData.slice(1, numTrades+1);
         //console.log(linesData)
    }
    //create the curved lines data
    function addLines() {
      //console.log("addLines");
      var info=""
      if(firstRun!=true) {
        //console.log("remove object ",lineObject.children.length);
        for (i = lineObject.children.length - 1; i >= 0 ; i -- ) { 
          var selectedObject=lineObject.children[i];
          lineObject.remove(selectedObject)
        }
      }
      //console.log("linesData ",linesData)
      var info=d3.select("#infoText").html("");
      for (var i = 0; i < linesData.length; i++) {
        endLon=linesData[i].lon;
        endLat=linesData[i].lat;
        var thickness=linesData[i].value;

        makeCurve(startLon,startLat,endLon,endLat,thickness);
        lineObject.add(curveObject);
      };
      drawBar()
      scene.add(lineObject);
      firstRun=false;
    }

    function barOver() {
      //console.log("barOver");
      var countryID=this.id;
      var cameraTarget=dataset.filter(function(el){
       return el.isocode===countryID;
      });
      var phi = cameraTarget[0].lat * Math.PI / 180;
      var theta = (cameraTarget[0].lon + 90) * Math.PI / 180;
      posX = (globeRadius+1300) * Math.cos(phi) * Math.sin(theta);
      posY = (globeRadius+1300) * Math.sin(phi);
      posZ = (globeRadius+1300) * Math.cos(phi) * Math.cos(theta);
      var from = {
        x : camera.position.x,
        y : camera.position.y,
        z : camera.position.z
      };
      var to = {
        x : posX,
        y : posY,
        z : posZ
      };
      var tween = new TWEEN.Tween(from)
      .to(to,400)
      .easing(TWEEN.Easing.Linear.None)
      .onUpdate(function () {
        camera.position.set(this.x, this.y, this.z);
        camera.lookAt(new THREE.Vector3(0,0,0));
      })
      .onComplete(function () {
        camera.lookAt(new THREE.Vector3(0,0,0));
      })
      .start();

      // camera.position.set(posX,posY,posZ);
      // camera.lookAt(new THREE.Vector3(0,0,0));
      var map;
      var material;
      map = textureCache(countryID, '#B46C80');
        material = new THREE.MeshPhongMaterial({map: map, transparent: true, opacity:0.7});
        if (!overlay) {
          overlay = new THREE.Mesh(new THREE.SphereGeometry(globeRadius+2.5, 40, 40), material);
          ftWorld.add(overlay);
        } else {
          overlay.material = material;
        }
    };
    

    function drawBar() {
      //console.log("function: drawBar");
      var barWidth=document.getElementById('infoPanel').getBoundingClientRect().width;
      var barHeight=350
      if(firstRun!=true){
        var barRemove=d3.select("#mainBar")
        .remove();
      }
      var barsvg = d3.select("#infoPanel").append('svg')
        .attr('id','mainBar')
        .attr("x",0)
        .attr("y",0)
        .attr("width", barWidth)
        .attr("height", barHeight);
      var barpadding = [0,0,0,100];
      linesData.sort(function(a, b) {return d3.descending(+a.value, +b.value);});

      var xScale = d3.scale.linear()
      .domain([ 0, d3.max(linesData, function(d) {return +d.value;}) ])
      .range([ barpadding[3], barWidth-barpadding[3]-barpadding[1]]);

      var yScale = d3.scale.ordinal()
      .domain(linesData.map(function(d) { return d.targetcountry; } ))
      .rangeBands([barpadding[0],barHeight],.1);

      var xAxis = d3.svg.axis()
              .scale(xScale)
              .orient("bottom");

      var yAxis = d3.svg.axis()
              .scale(yScale)
              .orient("right");

      var rects = barsvg.selectAll("rect")
      .data(linesData)
      .enter()
      .append("rect");
      rects
        .attr("fill", "#B36C80")
        .attr("id",function(d) {return d.targetiso})
        .attr("x", barpadding[3])
        .attr("y", function(d) {return yScale(d.targetcountry);})
        .attr("width", function(d) {return xScale(d.value)})
        .attr("height", yScale.rangeBand())
        .on("mouseover",barOver);
      barsvg.selectAll("text")
        .data(linesData)
        .enter()
        .append("text")
          .text(function(d) {return formatNumber(d.value/1000000000)})
          .attr("class","bartext")
          .attr("x", function(d) {return xScale(d.value)+70})
          .attr("y", function(d) {return yScale(d.targetcountry)+12;})

      // barsvg.append("g")
      //     .attr("class", "x axis")
      //     .attr("transform", "translate(" + barpadding[3] + "," + (barHeight - barpadding[1]) + ")")
      //     .call(xAxis);

      barsvg.append("g")
        .attr("class", "y axis")
        .attr("transform", "translate(-5,0)")
        .call(yAxis);

    }

    function onGlobeMousemove(event) {
      var map;
      var material;
      // Get pointc, convert to latitude/longitude
      var latlng = getEventCenter.call(this, event);
      // Look for country at that latitude/longitude
      var country = geo.search(latlng[0], latlng[1]);
      if (country !== null && country.code !== currentCountry) {
        // Track the current country displayed
        // Update the html
        //d3.select("#msg").html(country.code);
         // Overlay the selected country
        map = textureCache(country.code, '#B46C80');
        material = new THREE.MeshPhongMaterial({map: map, transparent: true, opacity:0.7});
        if (!overlay) {
          overlay = new THREE.Mesh(new THREE.SphereGeometry(globeRadius+2.5, 40, 40), material);
          ftWorld.add(overlay);
        } else {
          overlay.material = material;
        }
      }
    }

    function setEvents(camera, items, type, wait) {
      var extraWidth=document.getElementById('globeDiv').getBoundingClientRect().width;
      var extraHeight=document.getElementById('mainTitle').getBoundingClientRect().height+
      document.getElementById('graphsubhead').getBoundingClientRect().height;
      var listener = function(event) {
        var mouse = {
          x: ((event.clientX - 1) /(window.innerWidth+extraWidth) ) * 2 - 1,
          y: -((event.clientY - 1) /(window.innerHeight+extraHeight) ) * 2 + 1
        };

        var vector = new THREE.Vector3();
        vector.set(mouse.x, mouse.y, 0.5);
        vector.unproject(camera);

        raycaster.ray.set(camera.position, vector.sub(camera.position).normalize());

        var target = raycaster.intersectObjects(items);

        if (target.length) {
          target[0].type = type;
          target[0].object.dispatchEvent(target[0]);
        }
      };
      if (!wait) {
        document.addEventListener(type, listener, false);
      } else {
        document.addEventListener(type, debounce(listener, wait), false);
      }
    }

    function debounce(func, wait, immediate) {
      var timeout;
      return function() {
        var context = this, args = arguments;
        var later = function() {
          timeout = null;
          if (!immediate) {
            func.apply(context, args);
          }
        };
        var callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) {
          func.apply(context, args);
        }
      };
    }

    function animate() {
      var timer = Date.now() * 0.0001;
      TWEEN.update();
      camera.lookAt( scene.position );
      soptlight.position.copy( camera.getWorldPosition());
      soptlight.lookAt(scene.position);
      //ftWorld.rotation.y += 0.0005;
      //lineObject.rotation.y += 0.0005;
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }

    function getEventCenter(event, radius) {
      radius = radius || globeRadius;

      var point = getPoint.call(this, event);

      var latRads = Math.acos(point.y / radius);
      var lngRads = Math.atan2(point.z, point.x);
      var lat = (Math.PI / 2 - latRads) * (180 / Math.PI);
      var lng = (Math.PI - lngRads) * (180 / Math.PI);

      return [lat, lng - 180];
    }

    function getPoint(event) {
      // Get the vertices
      var a = this.geometry.vertices[event.face.a];
      var b = this.geometry.vertices[event.face.b];
      var c = this.geometry.vertices[event.face.c];

      // Averge them together
      var point = {
        x: (a.x + b.x + c.x) / 3,
        y: (a.y + b.y + c.y) / 3,
        z: (a.z + b.z + c.z) / 3
      };

      return point;
    }

    // http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html
    var pointInPolygon = function(poly, point) {
      var x = point[0];
      var y = point[1];
      var inside = false, xi, xj, yi, yj, xk;
      for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        xi = poly[i][0];
        yi = poly[i][1];
        xj = poly[j][0];
        yj = poly[j][1];
        xk = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (xk) {
           inside = !inside;
        }
      }

      return inside;
    };

    function mapTexture(geojson, color) {
      var texture;
      var context;
      var canvas;
      canvas = d3.select("body").append("canvas")
        .style("display", "none")
        .attr("width", "4096px")
        .attr("height", "2048px");
      context = canvas.node().getContext("2d");
      var path = d3.geo.path()
        .projection(projection)
        .context(context);
      context.strokeStyle = "#ffffff";
      context.lineWidth = 1;
      context.fillStyle = color || "#7fd8f5";
      context.beginPath();
      path(geojson);
      if (color) {
        context.fill();
      }
      //context.stroke();
      texture = new THREE.Texture(canvas.node());
      texture.needsUpdate = true;
      // console.log(canvas.node().toDataURL()); 

      canvas.remove();
      return texture;
    }

    function curveOver(){
      //console.log("curveOver")
    }

  });//End of json loading function

});





