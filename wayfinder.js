(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const canvas = $("worldCanvas");
  const ctx = canvas.getContext("2d");
  const WORLD = { width: 1000, height: 620 };
  const START = { x: 115, y: 115 };
  const DEFAULT_OBSTACLES = [
    { x: 270, y: 80, w: 72, h: 190 },
    { x: 465, y: 335, w: 205, h: 58 },
    { x: 720, y: 105, w: 65, h: 175 },
    { x: 160, y: 435, w: 175, h: 54 }
  ];
  let obstacles = DEFAULT_OBSTACLES.map(o => ({...o}));
  let programSource = "";
  let running = false;
  let paused = false;
  let stopRequested = false;
  let editMode = "";
  let lastRunResult = null;
  let frameCount = 0;
  let lastTelemetry = {};
  let resizeObserver = null;
  let activeNeuralRuntime = null;
  let nextEvolutionAgentId = 1;

  const state = {
    agent: { x: START.x, y: START.y, vx: 0, vy: 0, radius: 11, energy: 100, contactingSomething: false },
    goal: { x: 855, y: 500, radius: 14 },
    goals: 0, collisions: 0, steps: 0, elapsed: 0,
    lastDistance: 0, feedbackCooldown: 0, goalCooldown: 0,
    training: true, lastOutput: [0.5,0.5,0,0.5], lastInputs: Array(11).fill(0),
    distanceAtStart: 0, bestDistance: Infinity,
    evolutionEnabled: false,
    evolutionPopulationSize: 15,
    evolutionGeneration: 0,
    evolutionElapsed: 0,
    evolutionPopulation: [],
    evolutionSuccessorId: null,
    evolutionLastWinnerId: null,
    evolutionCompleted: 0,
    evolutionMutationRate: 0.075,
    evolutionMutationScale: 0.22,
    evolutionBestGoals: 0,
    evolutionBestDistance: Infinity
  };

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const length = (x,y) => Math.hypot(x,y);
  const normalized = (x,y) => { const d = length(x,y) || 1; return {x:x/d,y:y/d}; };
  const distanceToGoal = () => length(state.goal.x-state.agent.x,state.goal.y-state.agent.y);
  const addConsole = (message, kind) => {
    const line = document.createElement("p");
    line.textContent = String(message);
    if (kind) line.className = kind;
    $("consoleOutput").appendChild(line);
    $("consoleOutput").scrollTop = $("consoleOutput").scrollHeight;
    while ($("consoleOutput").children.length > 80) $("consoleOutput").firstChild.remove();
  };
  const setRuntime = label => {
    $("runtimeState").innerHTML = "<i></i> " + label;
    $("runtimeState").classList.toggle("active", label === "RUNNING" || label === "PAUSED");
    $("liveDot").classList.toggle("active", label === "RUNNING");
  };

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width*dpr));
    canvas.height = Math.max(1, Math.round(rect.height*dpr));
    drawWorld();
  }

  function nearestObstacle(agent=state.agent, obstacleSet=obstacles) {
    let best = { dx:0, dy:0, clearance:240, distance:240 };
    for (const box of obstacleSet) {
      const px = clamp(agent.x, box.x, box.x+box.w);
      const py = clamp(agent.y, box.y, box.y+box.h);
      let dx = px-agent.x, dy = py-agent.y;
      let d = length(dx,dy);
      if (d < 0.001) {
        const sides = [
          {d:Math.abs(agent.x-box.x),x:-1,y:0},
          {d:Math.abs(box.x+box.w-agent.x),x:1,y:0},
          {d:Math.abs(agent.y-box.y),x:0,y:-1},
          {d:Math.abs(box.y+box.h-agent.y),x:0,y:1}
        ].sort((a,b)=>a.d-b.d);
        dx=sides[0].x;dy=sides[0].y;d=0;
      }
      if (d < best.distance) best = {dx,dy,distance:d,clearance:Math.max(0,d-agent.radius)};
    }
    return best;
  }

  function updateSensors(vars, silent=false, obstacleSet=obstacles) {
    const a = state.agent, goal = state.goal;
    const gx=goal.x-a.x, gy=goal.y-a.y, gd=length(gx,gy)||1;
    const obstacle=nearestObstacle(a,obstacleSet), od=length(obstacle.dx,obstacle.dy)||1;
    const isContactingSomething = a.contactingSomething ? 1 : 0;
    const boundary=Math.min(a.x,a.y,WORLD.width-a.x,WORLD.height-a.y)-a.radius;
    const values = [
      clamp(goal.x/WORLD.width,0,1), clamp(goal.y/WORLD.height,0,1), clamp(gd/Math.hypot(WORLD.width,WORLD.height),0,1),
      obstacle.dx/od, obstacle.dy/od, clamp(obstacle.clearance/240,0,1),
      clamp(a.vx/210,-1,1), clamp(a.vy/210,-1,1),
      clamp(boundary/170,0,1), clamp(a.energy/100,0,1), isContactingSomething
    ];
    const names = ["goalLocationX","goalLocationY","goalDistance","obstacleDirectionX","obstacleDirectionY","obstacleDistance","velocityX","velocityY","boundaryProximity","energyLevel","isContactingSomething"];
    names.forEach((name,i)=>{vars[name]=values[i];});
    state.lastInputs=values;
    if(!silent){
          $("inGoalLocationX").textContent=values[0].toFixed(2);
          $("inGoalLocationY").textContent=values[1].toFixed(2);
          $("inGoalDistance").textContent=values[2].toFixed(2);
          $("inObstacleX").textContent=values[3].toFixed(2);
          $("inObstacleY").textContent=values[4].toFixed(2);
          $("inObstacleDistance").textContent=values[5].toFixed(2);
          $("inVelocityX").textContent=values[6].toFixed(2);
          $("inVelocityY").textContent=values[7].toFixed(2);
          $("inBoundary").textContent=values[8].toFixed(2);
          $("inEnergy").textContent=values[9].toFixed(2);
          $("inContact").textContent=values[10].toFixed(0);
    }
    return values;
  }

  function updateOutputReadouts(vars) {
    const outputs=[clamp(Number(vars.thrustX)||0.5,0,1),clamp(Number(vars.thrustY)||0.5,0,1),clamp(Number(vars.braking)||0,0,1),clamp(Number(vars.avoidanceGain)||0.5,0,1)];
    state.lastOutput=outputs;
    $("outThrustX").textContent=((outputs[0]*2)-1).toFixed(2);
    $("outThrustY").textContent=((outputs[1]*2)-1).toFixed(2);
    $("outBrake").textContent=outputs[2].toFixed(2);
    $("outAvoidance").textContent=outputs[3].toFixed(2);
  }

  function collideWithObstacle(box, agent=state.agent) {
    const a=agent;
    const px=clamp(a.x,box.x,box.x+box.w), py=clamp(a.y,box.y,box.y+box.h);
    let dx=a.x-px,dy=a.y-py,d=length(dx,dy);
    if(d>=a.radius)return false;
    let nx,ny,penetration;
    if(d>0.0001){nx=dx/d;ny=dy/d;penetration=a.radius-d;}
    else {
      const sides=[
        {d:a.x-box.x,nx:-1,ny:0,move:box.x-a.radius},
        {d:box.x+box.w-a.x,nx:1,ny:0,move:box.x+box.w+a.radius},
        {d:a.y-box.y,nx:0,ny:-1,move:box.y-a.radius,axis:"y"},
        {d:box.y+box.h-a.y,nx:0,ny:1,move:box.y+box.h+a.radius,axis:"y"}
      ].sort((x,y)=>x.d-y.d);
      const s=sides[0];nx=s.nx;ny=s.ny;penetration=s.d+a.radius;
      if(s.axis==="y")a.y=s.move;else a.x=s.move;
    }
    if(d>0.0001){a.x+=nx*penetration;a.y+=ny*penetration;}
    const toward=a.vx*nx+a.vy*ny;
    if(toward<0){a.vx-=1.25*toward*nx;a.vy-=1.25*toward*ny;}
    a.vx*=0.72;a.vy*=0.72;
    return true;
  }

  function randomFreePoint(margin, obstacleSet=obstacles, fromAgent=state.agent) {
    for(let attempt=0;attempt<160;attempt++){
      const p={x:margin+Math.random()*(WORLD.width-2*margin),y:margin+Math.random()*(WORLD.height-2*margin)};
      const blocked=obstacleSet.some(o=>p.x>o.x-30&&p.x<o.x+o.w+30&&p.y>o.y-30&&p.y<o.y+o.h+30);
      if(!blocked&&length(p.x-fromAgent.x,p.y-fromAgent.y)>130)return p;
    }
    return {x:WORLD.width-75,y:WORLD.height-70};
  }


  function clonePolicy(policy) {
    return {
      sizes: policy.sizes.slice(),
      weights: policy.weights.map(layer=>layer.map(row=>row.slice())),
      biases: policy.biases.map(layer=>layer.slice())
    };
  }

  function gaussianNoise() {
    const u=Math.max(1e-12,Math.random()),v=Math.random();
    return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
  }

  function mutatePolicy(source, rate=state.evolutionMutationRate) {
    const copy=clonePolicy(source);
    for(const layer of copy.weights)for(const row of layer)for(let i=0;i<row.length;i++){
      if(Math.random()<rate)row[i]=clamp(row[i]+gaussianNoise()*state.evolutionMutationScale,-8,8);
    }
    for(const layer of copy.biases)for(let i=0;i<layer.length;i++){
      if(Math.random()<rate)layer[i]=clamp(layer[i]+gaussianNoise()*state.evolutionMutationScale,-8,8);
    }
    return copy;
  }

  function createIndependentObstacleSet() {
    // Give each candidate independently offset geometry based on the active layout.
    return obstacles.map(box=>{
      const x=clamp(box.x+(Math.random()-.5)*150,35,WORLD.width-box.w-35);
      const y=clamp(box.y+(Math.random()-.5)*130,35,WORLD.height-box.h-35);
      return {x,y,w:box.w,h:box.h};
    }).filter(box=>!(START.x>box.x-35&&START.x<box.x+box.w+35&&
      START.y>box.y-35&&START.y<box.y+box.h+35));
  }

  function resetEvolutionCandidate(candidate,index) {
    const start={x:clamp(START.x+(Math.random()-.5)*24,35,WORLD.width-35),y:clamp(START.y+(Math.random()-.5)*24,35,WORLD.height-35)};
    candidate.x=start.x;candidate.y=start.y;candidate.vx=0;candidate.vy=0;
    candidate.radius=11;candidate.energy=100;candidate.obstacles=createIndependentObstacleSet();
    candidate.goal=randomFreePoint(45,candidate.obstacles,candidate);candidate.goal.radius=14;
    candidate.goalsCollected=0;candidate.collisions=0;candidate.steps=0;candidate.elapsed=0;
    candidate.initialDistance=length(candidate.goal.x-candidate.x,candidate.goal.y-candidate.y);
    candidate.bestDistance=candidate.initialDistance;candidate.lastDistance=candidate.initialDistance;
    candidate.contactingSomething=false;candidate.eliminated=false;candidate.index=index;
    return candidate;
  }

  function createEvolutionCandidate(policy,index) {
    return resetEvolutionCandidate({id:nextEvolutionAgentId++,policy:clonePolicy(policy),isSuccessor:false},index);
  }

  function seedEvolutionPopulation(runtime) {
    const base=runtime.exportWeights("Wayfinder");
    const count=clamp(Math.round(Number($("evolutionPopulationSize").value)||15),15,300);
    state.evolutionPopulationSize=count;
    state.evolutionPopulation=[];
    state.evolutionGeneration=1;
    state.evolutionElapsed=0;
    state.evolutionSuccessorId=null;
    state.evolutionLastWinnerId=null;
    state.evolutionCompleted=0;
    state.evolutionBestGoals=0;
    state.evolutionBestDistance=Infinity;
    for(let i=0;i<count;i++){
      const policy=i===0?clonePolicy(base):mutatePolicy(base,0.18);
      state.evolutionPopulation.push(createEvolutionCandidate(policy,i));
    }
    addConsole("Evolution initialized: "+count+" agents in generation 1.");
    updateEvolutionReadouts();
  }

  function candidateSensors(candidate) {
    const savedAgent=state.agent,savedGoal=state.goal;
    state.agent=candidate;state.goal=candidate.goal;
    const vars=Object.create(null);
    updateSensors(vars,true,candidate.obstacles);
    state.agent=savedAgent;state.goal=savedGoal;
    return vars;
  }

  function candidateStep(candidate,dt,runtime) {
    if(candidate.eliminated)return candidate.goalsCollected;
    runtime.importWeights("Wayfinder",candidate.policy);
    const vars=candidateSensors(candidate);
    const outputs=runtime.run("Wayfinder",vars);
    runtime.observe("Wayfinder");
    const tx=clamp((Number(vars.thrustX)||0.5)*2-1,-1,1);
    const ty=clamp((Number(vars.thrustY)||0.5)*2-1,-1,1);
    const brake=clamp(Number(vars.braking)||0,0,1);
    const avoidance=clamp(Number(vars.avoidanceGain)||0.5,0,1);
    const savedAgent=state.agent,savedGoal=state.goal;
    state.agent=candidate;state.goal=candidate.goal;
    const sensor=nearestObstacle(candidate,candidate.obstacles);
    let ax=tx,ay=ty;
    if(sensor.clearance<125){
      const away=normalized(-sensor.dx,-sensor.dy);
      const urgency=clamp((125-sensor.clearance)/125,0,1);
      ax+=away.x*urgency*avoidance*1.25;
      ay+=away.y*urgency*avoidance*1.25;
    }
    const magnitude=length(ax,ay);
    if(magnitude>1.45){ax=ax/magnitude*1.45;ay=ay/magnitude*1.45;}
    const before=distanceToGoal();
    candidate.vx+=ax*165*dt;candidate.vy+=ay*165*dt;
    const drag=Math.pow(0.985,dt*60)*Math.exp(-6.5*brake*dt);
    candidate.vx*=drag;candidate.vy*=drag;
    const speed=length(candidate.vx,candidate.vy);
    if(speed>210){candidate.vx=candidate.vx/speed*210;candidate.vy=candidate.vy/speed*210;}
    candidate.x+=candidate.vx*dt;candidate.y+=candidate.vy*dt;
    let hit=false;
    for(const box of candidate.obstacles)if(collideWithObstacle(box,candidate))hit=true;
    const r=candidate.radius;
    if(candidate.x<r){candidate.x=r;candidate.vx=Math.abs(candidate.vx)*.35;hit=true;}
    if(candidate.x>WORLD.width-r){candidate.x=WORLD.width-r;candidate.vx=-Math.abs(candidate.vx)*.35;hit=true;}
    if(candidate.y<r){candidate.y=r;candidate.vy=Math.abs(candidate.vy)*.35;hit=true;}
    if(candidate.y>WORLD.height-r){candidate.y=WORLD.height-r;candidate.vy=-Math.abs(candidate.vy)*.35;hit=true;}
    candidate.contactingSomething=hit||distanceToGoal()<=candidate.radius+candidate.goal.radius;
    if(hit)candidate.collisions++;
    const after=distanceToGoal();
    candidate.lastDistance=after;
    candidate.bestDistance=Math.min(candidate.bestDistance,after);
    candidate.energy=Math.max(0,candidate.energy-(.09+.12*(Math.abs(ax)+Math.abs(ay)))*dt);
    candidate.steps++;candidate.elapsed+=dt;
    let feedback=0,strength=.2;
    if(hit){feedback=-1;strength=.8;}
    else if(before-after>.45){feedback=1;strength=.25;}
    if(after<candidate.radius+candidate.goal.radius){
      candidate.goalsCollected++;
      candidate.energy=Math.min(100,candidate.energy+28);
      candidate.goal=randomFreePoint(45,candidate.obstacles,candidate);
      candidate.goal.radius=14;
      feedback=1;strength=1;
      candidate.lastDistance=length(candidate.goal.x-candidate.x,candidate.goal.y-candidate.y);
    }
    // Zero energy only eliminates an agent before its first successful goal.
    if(candidate.energy<=0&&candidate.goalsCollected===0)candidate.eliminated=true;
    if(state.training&&feedback>0)runtime.reward("Wayfinder",strength);
    else if(state.training&&feedback<0)runtime.correct("Wayfinder",strength);
    candidate.policy=runtime.exportWeights("Wayfinder");
    state.agent=savedAgent;state.goal=savedGoal;
    return candidate.goalsCollected;
  }

  function selectTimeoutWinner() {
    // Original Agent Five priority: goal count, measured goal progress, energy.
    return state.evolutionPopulation.slice().sort((a,b)=>{
      if(b.goalsCollected!==a.goalsCollected)return b.goalsCollected-a.goalsCollected;
      const progressA=Math.max(0,a.initialDistance-a.bestDistance);
      const progressB=Math.max(0,b.initialDistance-b.bestDistance);
      if(Math.abs(progressB-progressA)>0.0001)return progressB-progressA;
      return b.energy-a.energy;
    })[0]||null;
  }

  function beginNextGeneration(winner,reason) {
    if(!winner)return;
    winner.isSuccessor=true;
    state.evolutionSuccessorId=winner.id;
    state.evolutionLastWinnerId=winner.id;
    state.evolutionCompleted++;
    const winningGoals=winner.goalsCollected;
    const elitePolicy=clonePolicy(winner.policy);
    const count=state.evolutionPopulationSize;
    // Keep the winning candidate and exact policy as elite, but give it a fresh arena.
    resetEvolutionCandidate(winner,0);
    winner.isSuccessor=true;
    const next=[winner];
    for(let i=1;i<count;i++){
      next.push(createEvolutionCandidate(mutatePolicy(elitePolicy,state.evolutionMutationRate),i));
    }
    state.evolutionPopulation=next;
    state.evolutionGeneration++;
    state.evolutionElapsed=0;
    state.evolutionBestGoals=0;
    state.evolutionBestDistance=Infinity;
    addConsole("Generation "+(state.evolutionGeneration-1)+" successor: Agent #"+winner.id+
      " ("+winningGoals+" goals). "+reason+". Unchanged elite retained; "+(count-1)+" mutated descendants created.","console-good");
    updateEvolutionReadouts();
  }

  function updateEvolutionReadouts() {
    const population=state.evolutionPopulation;
    const best=population.reduce((a,b)=>!a||b.goalsCollected>a.goalsCollected||
      (b.goalsCollected===a.goalsCollected&&b.bestDistance<a.bestDistance)?b:a,null);
    $("evolutionGeneration").textContent=String(state.evolutionGeneration||0);
    $("evolutionPopulationCount").textContent=population.length+" / "+state.evolutionPopulationSize;
    $("evolutionElapsed").textContent=Math.floor(state.evolutionElapsed)+"s / 120s";
    $("evolutionWinner").textContent=state.evolutionSuccessorId===null?"Searching":("Elite #"+state.evolutionSuccessorId);
    $("evolutionBest").textContent=best?("#"+best.id+" · "+best.goalsCollected+" goals"):"—";
    $("evolutionCompleted").textContent=String(state.evolutionCompleted);
    drawEvolutionPopulation();
  }

  function drawEvolutionPopulation() {
    const population=state.evolutionPopulation;
    const target=$("populationCanvas");
    if(!target||!target.getContext)return;
    const draw=target.getContext("2d");
    const columns=Math.min(10,Math.max(3,Math.ceil(Math.sqrt(population.length))));
    const rows=Math.ceil(population.length/columns);
    const tileW=92,tileH=64,gap=5,pad=8;
    target.width=pad*2+columns*(tileW+gap)-gap;
    target.height=pad*2+rows*(tileH+gap)-gap;
    draw.fillStyle="#0c1219";draw.fillRect(0,0,target.width,target.height);
    population.forEach((agent,index)=>{
      const x=pad+(index%columns)*(tileW+gap),y=pad+Math.floor(index/columns)*(tileH+gap);
      draw.fillStyle=agent.isSuccessor?"#342c17":"#17222e";
      draw.fillRect(x,y,tileW,tileH);
      draw.strokeStyle=agent.isSuccessor?"#e5bd4f":"#34465a";draw.lineWidth=1;draw.strokeRect(x+.5,y+.5,tileW-1,tileH-1);
      draw.fillStyle="#b9c8d8";draw.font="10px ui-monospace,monospace";draw.fillText("#"+agent.id,x+6,y+12);
      draw.fillStyle="#74d8bd";draw.fillText(agent.goalsCollected+" / 5",x+tileW-31,y+12);
      const miniX=x+6,miniY=y+19,miniW=tileW-12,miniH=tileH-30;
      (agent.obstacles||[]).forEach(box=>{
        draw.fillStyle="#647386";
        draw.fillRect(miniX+(box.x/WORLD.width)*miniW,miniY+(box.y/WORLD.height)*miniH,
          Math.max(1,(box.w/WORLD.width)*miniW),Math.max(1,(box.h/WORLD.height)*miniH));
      });
      if(agent.goal){
        draw.beginPath();draw.arc(miniX+(agent.goal.x/WORLD.width)*miniW,miniY+(agent.goal.y/WORLD.height)*miniH,2.2,0,Math.PI*2);
        draw.fillStyle="#74d8bd";draw.fill();
      }
      draw.fillStyle="#ef343b";draw.beginPath();
      draw.arc(miniX+(agent.x/WORLD.width)*miniW,miniY+(agent.y/WORLD.height)*miniH,3.2,0,Math.PI*2);draw.fill();
      draw.fillStyle="#3a4a5d";draw.fillRect(x+6,y+tileH-8,tileW-12,3);
      draw.fillStyle=agent.energy<25?"#e87979":"#74d8bd";
      draw.fillRect(x+6,y+tileH-8,(tileW-12)*agent.energy/100,3);
    });
  }

  function applyEvolutionFrame(vars,seconds) {
    const runtime=activeNeuralRuntime;
    if(!runtime){vars.feedbackSignal=0;return;}
    const dt=clamp(Number(seconds)||.02,.008,.04);
    if(!state.evolutionPopulation.length)seedEvolutionPopulation(runtime);
    state.evolutionElapsed+=dt;
    let winner=null;
    for(const candidate of state.evolutionPopulation){
      candidateStep(candidate,dt,runtime);
      if(candidate.goalsCollected>=5){winner=candidate;break;}
      if(candidate.goalsCollected>state.evolutionBestGoals)state.evolutionBestGoals=candidate.goalsCollected;
      state.evolutionBestDistance=Math.min(state.evolutionBestDistance,candidate.bestDistance);
    }
    if(winner)beginNextGeneration(winner,"goal threshold reached");
    else if(state.evolutionElapsed>=120)beginNextGeneration(selectTimeoutWinner(),"120-second generation timeout");
    const best=state.evolutionPopulation.reduce((a,b)=>!a||b.goalsCollected>a.goalsCollected||
      (b.goalsCollected===a.goalsCollected&&b.bestDistance<a.bestDistance)?b:a,null);
    if(best){
      state.agent=best;state.goal=best.goal;
      state.goals=best.goalsCollected;state.collisions=best.collisions;
      state.steps=best.steps;state.elapsed=best.elapsed;
      $("goalCount").textContent=String(best.goalsCollected);
      $("collisionCount").textContent=String(best.collisions);
      $("stepCount").textContent=best.steps.toLocaleString();
      $("energyValue").textContent=Math.round(best.energy)+"%";
      $("energyMeter").style.width=best.energy+"%";
      drawWorld();
    }
    vars.feedbackSignal=0;vars.feedbackStrength=0;
    updateEvolutionReadouts();
  }

  function applyFrame(vars, seconds) {
    if(paused||stopRequested){vars.feedbackSignal=0;return;}
    const dt=clamp(Number(seconds)||0.02,0.008,0.04);
    if(state.evolutionEnabled){applyEvolutionFrame(vars,dt);return;}
    state.feedbackCooldown=Math.max(0,state.feedbackCooldown-dt);
    const a=state.agent;
    updateOutputReadouts(vars);
    let tx=(state.lastOutput[0]*2)-1,ty=(state.lastOutput[1]*2)-1;
    const brake=state.lastOutput[2],avoidance=state.lastOutput[3];
    const sensor=nearestObstacle();
    const clearance=sensor.clearance;
    if(clearance<125){
      const away=normalized(-sensor.dx,-sensor.dy);
      const urgency=clamp((125-clearance)/125,0,1);
      tx+=away.x*urgency*avoidance*1.25;
      ty+=away.y*urgency*avoidance*1.25;
    }
    const mag=length(tx,ty);
    if(mag>1.45){tx=tx/mag*1.45;ty=ty/mag*1.45;}
    const before=distanceToGoal();
    const ax=tx*165,ay=ty*165;
    a.vx+=ax*dt;a.vy+=ay*dt;
    const drag=Math.pow(0.985,dt*60)*Math.exp(-6.5*brake*dt);
    a.vx*=drag;a.vy*=drag;
    const speed=length(a.vx,a.vy);
    if(speed>210){a.vx=a.vx/speed*210;a.vy=a.vy/speed*210;}
    a.x+=a.vx*dt;a.y+=a.vy*dt;
    let hit=false;
    for(const box of obstacles)if(collideWithObstacle(box)){hit=true;}
    const r=a.radius;
    if(a.x<r){a.x=r;a.vx=Math.abs(a.vx)*0.35;hit=true;}
    if(a.x>WORLD.width-r){a.x=WORLD.width-r;a.vx=-Math.abs(a.vx)*0.35;hit=true;}
    if(a.y<r){a.y=r;a.vy=Math.abs(a.vy)*0.35;hit=true;}
    if(a.y>WORLD.height-r){a.y=WORLD.height-r;a.vy=-Math.abs(a.vy)*0.35;hit=true;}
    const touchingGoalBeforeRelocation=distanceToGoal()<=a.radius+state.goal.radius;
    a.contactingSomething=hit||touchingGoalBeforeRelocation;
    if(hit){
      state.collisions++;
      vars.feedbackSignal=state.training&&state.feedbackCooldown<=0?-1:0;
      vars.feedbackStrength=1;
      if(vars.feedbackSignal<0)state.feedbackCooldown=0.25;
    }else{
      const after=distanceToGoal(),progress=before-after;
      vars.feedbackSignal=0;vars.feedbackStrength=0.15;
      if(state.training&&state.feedbackCooldown<=0&&progress>0.45){vars.feedbackSignal=1;state.feedbackCooldown=0.12;}
    }
    a.energy=Math.max(0,a.energy-(0.09+0.12*(Math.abs(tx)+Math.abs(ty)))*dt);
    if(a.energy<=0){a.vx*=0.985;a.vy*=0.985;if(state.training){vars.feedbackSignal=-1;vars.feedbackStrength=0.5;}}
    const goalDistance=distanceToGoal();
    if(goalDistance<a.radius+state.goal.radius){
      state.goals++;vars.feedbackSignal=state.training?1:0;vars.feedbackStrength=1;
      a.energy=Math.min(100,a.energy+28);
      state.goal=randomFreePoint(45);state.goal.radius=14;
      state.lastDistance=distanceToGoal();
      addConsole("Goal reached. Nexius reward applied.", "console-good");
    }else state.lastDistance=goalDistance;
    state.steps++;state.elapsed+=dt;
    updateSensors(vars);
    $("goalCount").textContent=String(state.goals);
    $("collisionCount").textContent=String(state.collisions);
    $("stepCount").textContent=state.steps.toLocaleString();
    $("energyValue").textContent=Math.round(a.energy)+"%";
    $("energyMeter").style.width=a.energy+"%";
    $("energyMeter").style.background=a.energy<25?"#ef777d":"#74d8bd";
    drawWorld();
    frameCount++;
  }

  function drawWorld() {
    if(!ctx)return;
    const rect=canvas.getBoundingClientRect();
    const cssW=rect.width||800,cssH=rect.height||496,dpr=Math.min(window.devicePixelRatio||1,2);
    if(canvas.width!==Math.round(cssW*dpr)||canvas.height!==Math.round(cssH*dpr)){
      canvas.width=Math.round(cssW*dpr);canvas.height=Math.round(cssH*dpr);
    }
    ctx.setTransform(dpr*cssW/WORLD.width,0,0,dpr*cssH/WORLD.height,0,0);
    ctx.clearRect(0,0,WORLD.width,WORLD.height);
    ctx.fillStyle="#121a22";ctx.fillRect(0,0,WORLD.width,WORLD.height);
    ctx.strokeStyle="rgba(142,165,185,.075)";ctx.lineWidth=1;
    for(let x=20;x<WORLD.width;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,WORLD.height);ctx.stroke();}
    for(let y=20;y<WORLD.height;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(WORLD.width,y);ctx.stroke();}
    ctx.strokeStyle="#40505f";ctx.lineWidth=2;ctx.strokeRect(1,1,WORLD.width-2,WORLD.height-2);
    const activeObstacles=state.agent.obstacles||obstacles;
    for(const o of activeObstacles){
      ctx.fillStyle="#303c49";ctx.strokeStyle="#596a7b";ctx.lineWidth=1.4;
      ctx.beginPath();ctx.roundRect(o.x,o.y,o.w,o.h,5);ctx.fill();ctx.stroke();
      ctx.fillStyle="rgba(255,255,255,.035)";ctx.fillRect(o.x+5,o.y+5,Math.max(0,o.w-10),3);
    }
    const g=state.goal;
    ctx.beginPath();ctx.arc(g.x,g.y,g.radius+8,0,Math.PI*2);ctx.fillStyle="rgba(116,216,189,.08)";ctx.fill();
    ctx.beginPath();ctx.arc(g.x,g.y,g.radius,0,Math.PI*2);ctx.fillStyle="#74d8bd";ctx.fill();
    ctx.beginPath();ctx.arc(g.x,g.y,3,0,Math.PI*2);ctx.fillStyle="#e7fff7";ctx.fill();
    const a=state.agent;
    const speed=length(a.vx,a.vy);
    if(speed>7){
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(a.x+a.vx*.16,a.y+a.vy*.16);
      ctx.strokeStyle="rgba(239,52,59,.45)";ctx.lineWidth=2;ctx.stroke();
    }
    // Canonical Agent Five appearance: a plain, solid red circle.
    ctx.beginPath();ctx.arc(a.x,a.y,a.radius,0,Math.PI*2);ctx.fillStyle="#ef343b";ctx.fill();
    if(editMode){
      ctx.fillStyle="rgba(116,216,189,.08)";ctx.fillRect(0,0,WORLD.width,WORLD.height);
    }
  }

  function updateModeButtons(){
    $("obstacleBtn").setAttribute("aria-pressed",String(editMode==="obstacle"));
    $("goalBtn").setAttribute("aria-pressed",String(editMode==="goal"));
    $("canvasHint").textContent=editMode==="obstacle"?"Tap the field to place an obstacle.":editMode==="goal"?"Tap the field to move the goal.":"Select “Place obstacle” or “Move goal” to edit the field.";
  }

  function canvasPoint(event){
    const r=canvas.getBoundingClientRect();
    return {x:clamp((event.clientX-r.left)/r.width*WORLD.width,20,WORLD.width-20),y:clamp((event.clientY-r.top)/r.height*WORLD.height,20,WORLD.height-20)};
  }
  canvas.addEventListener("click",event=>{
    if(!editMode)return;
    const p=canvasPoint(event);
    if(editMode==="goal"){
      const clear=obstacles.every(o=>p.x<o.x-25||p.x>o.x+o.w+25||p.y<o.y-25||p.y>o.y+o.h+25);
      if(clear){state.goal={x:p.x,y:p.y,radius:14};state.lastDistance=distanceToGoal();addConsole("Goal moved.");}
    }else{
      const box={x:clamp(p.x-34,15,WORLD.width-83),y:clamp(p.y-24,15,WORLD.height-63),w:68,h:48};
      const clear=obstacles.every(o=>box.x+box.w<o.x-12||box.x>o.x+o.w+12||box.y+box.h<o.y-12||box.y>o.y+o.h+12);
      const clearOfAgent=state.agent.x<box.x-20||state.agent.x>box.x+box.w+20||state.agent.y<box.y-20||state.agent.y>box.y+box.h+20;
      if(clear&&clearOfAgent){obstacles.push(box);addConsole("Obstacle placed.");}
    }
    editMode="";updateModeButtons();drawWorld();
  });

  function resetAgent(){
    state.agent={x:START.x,y:START.y,vx:0,vy:0,radius:11,energy:100,contactingSomething:false};
    state.goals=0;state.collisions=0;state.steps=0;state.elapsed=0;state.feedbackCooldown=0;
    state.evolutionPopulation=[];state.evolutionGeneration=0;state.evolutionElapsed=0;
    state.evolutionSuccessorId=null;state.evolutionLastWinnerId=null;state.evolutionCompleted=0;
    state.lastDistance=distanceToGoal();state.bestDistance=state.lastDistance;
    $("goalCount").textContent="0";$("collisionCount").textContent="0";$("stepCount").textContent="0";
    $("energyValue").textContent="100%";$("energyMeter").style.width="100%";
    drawWorld();
  }
  function randomizeLayout(){
    obstacles=[];
    const candidates=[
      {x:245,y:90,w:70,h:160},{x:430,y:235,w:175,h:55},{x:700,y:105,w:65,h:160},
      {x:180,y:420,w:180,h:55},{x:590,y:455,w:150,h:52}
    ];
    const removeIndex=Math.floor(Math.random()*candidates.length);
    obstacles=candidates.filter((o,i)=>i!==removeIndex).map(o=>({...o}));
    resetAgent();state.goal={x:850,y:500,radius:14};state.lastDistance=distanceToGoal();
    addConsole("Environment layout randomized.");
  }

  async function runAgent(){
    if(running)return;
    if(!window.NexiusCompiler||!window.NexiusModules||!window.NexiusModules.neural){
      addConsole("Nexius compiler or neural module failed to load.","console-error");return;
    }
    try{
      const response=await fetch("Wayfinder.nexius",{cache:"no-store"});
      if(!response.ok)throw new Error("Could not load Wayfinder.nexius ("+response.status+").");
      programSource=await response.text();
      const compiled=window.NexiusCompiler.compile(programSource);
      running=true;paused=false;stopRequested=false;
      $("startBtn").disabled=true;$("pauseBtn").disabled=false;$("stopBtn").disabled=false;
      $("pauseBtn").textContent="Ⅱ Pause";setRuntime("RUNNING");
      addConsole("Compiling Wayfinder.nexius...");
      addConsole("Nexius compilation successful. "+compiled.instructionCount+" instructions parsed.","console-good");
      activeNeuralRuntime=null;
      lastRunResult=await window.NexiusCompiler.run(compiled,{
        output:value=>addConsole(value),
        onNeuralRuntime:runtime=>{activeNeuralRuntime=runtime;},
        isStopped:()=>stopRequested,
        onFrame:(vars,seconds)=>{
          if(stopRequested)return;
          applyFrame(vars,seconds);
        }
      },{maxSteps:100000000});
      if(lastRunResult&&lastRunResult.stopped)addConsole("Wayfinder execution stopped.");
    }catch(error){
      addConsole((error&&error.line?"Line "+error.line+": ":"")+String(error&&error.message||error),"console-error");
      setRuntime("ERROR");
    }finally{
      running=false;paused=false;
      $("startBtn").disabled=false;$("pauseBtn").disabled=true;$("stopBtn").disabled=true;
      $("pauseBtn").textContent="Ⅱ Pause";
      if(!$("runtimeState").textContent.includes("ERROR"))setRuntime("IDLE");
    }
  }

  function setPaused(value){
    if(!running)return;
    paused=Boolean(value);
    $("pauseBtn").textContent=paused?"▶ Resume":"Ⅱ Pause";
    setRuntime(paused?"PAUSED":"RUNNING");
  }
  function stopAgent(){if(running){stopRequested=true;setRuntime("STOPPING");}}
  function resetSession(){
    if(running){stopRequested=true;const wait=()=>{if(running){setTimeout(wait,40);return;}resetSessionNow();};wait();}
    else resetSessionNow();
  }
  function resetSessionNow(){
    resetAgent();obstacles=DEFAULT_OBSTACLES.map(o=>({...o}));state.goal={x:855,y:500,radius:14};
    state.lastDistance=distanceToGoal();$("consoleOutput").replaceChildren();
    addConsole("Environment reset. Neural weights are initialized when the next run starts.");
    setRuntime("IDLE");drawWorld();
  }

  function exportMetrics(){
    const data={
      model:"Agent-Five-Wayfinder",version:"1.0.0",topology:[11,15,15,14,14,10,10,8,4],
      appearance:"solid red circle",movement:"continuous X/Y thrust with braking",
      evolution:{enabled:state.evolutionEnabled,generation:state.evolutionGeneration,populationSize:state.evolutionPopulationSize,completedGenerations:state.evolutionCompleted,eliteAgentId:state.evolutionSuccessorId},
      metrics:{goals:state.goals,collisions:state.collisions,steps:state.steps,elapsedSeconds:Number(state.elapsed.toFixed(2)),energy:state.agent.energy},
      note:"This export contains run metrics only; neural weights remain session-local."
    };
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);const link=document.createElement("a");
    link.href=url;link.download="agent-five-wayfinder-run.json";link.click();URL.revokeObjectURL(url);
  }

  $("startBtn").addEventListener("click",runAgent);
  $("pauseBtn").addEventListener("click",()=>setPaused(!paused));
  $("stopBtn").addEventListener("click",stopAgent);
  $("resetBtn").addEventListener("click",resetSession);
  $("layoutBtn").addEventListener("click",randomizeLayout);
  $("obstacleBtn").addEventListener("click",()=>{editMode=editMode==="obstacle"?"":"obstacle";updateModeButtons();drawWorld();});
  $("goalBtn").addEventListener("click",()=>{editMode=editMode==="goal"?"":"goal";updateModeButtons();drawWorld();});
  $("trainingToggle").addEventListener("change",event=>{state.training=event.target.checked;$("trainingStatus").textContent=state.training?"Enabled":"Disabled";});
  $("evolutionToggle").addEventListener("change",event=>{
    state.evolutionEnabled=event.target.checked;
    $("evolutionStatus").textContent=state.evolutionEnabled?"Generational mode":"Single-agent mode";
    if(state.evolutionEnabled)addConsole("Generational training selected. Population starts when the agent runs.");
    else addConsole("Single-agent mode selected.");
  });
  $("evolutionPopulationSize").addEventListener("change",event=>{
    const value=clamp(Math.round(Number(event.target.value)||15),15,300);
    event.target.value=String(value);state.evolutionPopulationSize=value;
  });
  $("clearConsoleBtn").addEventListener("click",()=>$("consoleOutput").replaceChildren());
  $("exportBtn").addEventListener("click",exportMetrics);
  state.lastDistance=distanceToGoal();
  if("ResizeObserver"in window){resizeObserver=new ResizeObserver(resizeCanvas);resizeObserver.observe(canvas);}
  window.addEventListener("resize",resizeCanvas);
  resizeCanvas();updateModeButtons();drawWorld();
  addConsole("AFW-1.0.0 initialized. The red circle is Agent Five.");
  $("evolutionStatus").textContent="Single-agent mode";
  updateEvolutionReadouts();
  addConsole("Nexius source: Wayfinder.nexius · Neural layers: 11-15-15-14-14-10-10-8-4");
})();