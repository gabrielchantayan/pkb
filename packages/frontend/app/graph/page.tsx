'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { use_relationship_graph } from '@/lib/hooks/use-relationships';
import { Card } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  ),
});

interface GraphNode {
  id: string;
  name: string;
  val: number;
  color: string;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
  value: number;
}

export default function GraphPage() {
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graph_ref = useRef<any>(null);
  const [dimensions, set_dimensions] = useState({ width: 800, height: 600 });
  const container_ref = useRef<HTMLDivElement>(null);
  const { data, isLoading } = use_relationship_graph();

  useEffect(() => {
    if (graph_ref.current?.d3Force) {
      graph_ref.current.d3Force('charge')?.strength(-300);
    }
  }, [data]);

  useEffect(() => {
    function update_dimensions() {
      if (container_ref.current) {
        set_dimensions({
          width: container_ref.current.clientWidth,
          height: container_ref.current.clientHeight,
        });
      }
    }

    update_dimensions();
    window.addEventListener('resize', update_dimensions);
    return () => window.removeEventListener('resize', update_dimensions);
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Relationship Graph</h1>
        <Card className="h-[calc(100vh-200px)] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </Card>
      </div>
    );
  }

  const graph_data: { nodes: GraphNode[]; links: GraphLink[] } = {
    nodes:
      data?.contacts.map((c) => ({
        id: c.id,
        name: c.displayName,
        val: c.engagementScore || 1,
        color: c.starred ? '#fbbf24' : '#6b7280',
      })) || [],
    links:
      data?.relationships.map((r) => ({
        source: r.contact_a_id,
        target: r.contact_b_id,
        value: r.strength || 1,
      })) || [],
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Relationship Graph</h1>

      <Card ref={container_ref} className="h-[calc(100vh-200px)] overflow-hidden">
          {graph_data.nodes.length > 0 ? (
            <ForceGraph2D
              ref={graph_ref}
              graphData={graph_data}
              width={dimensions.width}
              height={dimensions.height}
              nodeLabel="name"
              nodeRelSize={6}
              nodeVal={(node) => (node as GraphNode).val}
              nodeColor={(node) => (node as GraphNode).color}
              linkWidth={(link) => Math.sqrt((link as GraphLink).value)}
              linkColor={() => '#e5e7eb'}
              onNodeClick={(node) => {
                router.push(`/contacts/${(node as GraphNode).id}`);
              }}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const graph_node = node as GraphNode;
                const label = graph_node.name;
                const fontSize = 12 / globalScale;
                ctx.font = `${fontSize}px Sans-Serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = graph_node.color;
                ctx.beginPath();
                ctx.arc(graph_node.x || 0, graph_node.y || 0, graph_node.val, 0, 2 * Math.PI);
                ctx.fill();
                ctx.fillStyle = '#000';
                ctx.fillText(label, graph_node.x || 0, (graph_node.y || 0) + graph_node.val + fontSize);
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              No relationship data available. Add contacts and relationships to see the graph.
            </div>
          )}
      </Card>
    </div>
  );
}
